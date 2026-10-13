/// <reference lib="webworker" />

import { drainQueue, queueRun } from "./utils/sw-queue";
import { cacheName, chooseStrategy } from "./utils/sw-strategies";

declare const self: ServiceWorkerGlobalScope;

interface SyncEvent extends Event {
  readonly tag: string;
  waitUntil(promise: Promise<unknown>): void;
}

declare global {
  interface ServiceWorkerGlobalScope {
    readonly __SW_ASSETS__: string[];
  }
}

const PRECACHE = cacheName("precache");
const API_CACHE = cacheName("api");
const ASSET_CACHE = cacheName("assets");

const precacheAssets = self.__SW_ASSETS__ ?? [];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(PRECACHE)
      .then((cache) => cache.addAll(precacheAssets))
      .then(() => {
        // First install only: take control immediately so the very first
        // load becomes controlled. On an UPDATE the new worker must WAIT —
        // register-sw.ts shows "Update available" and posts SKIP_WAITING on
        // Reload; skipping here would swap before the user confirms.
        if (!self.registration.active) return self.skipWaiting();
      }),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith("at-") && key !== PRECACHE && key !== API_CACHE && key !== ASSET_CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  const strategy = chooseStrategy(event.request, url);

  switch (strategy) {
    case "precache":
      event.respondWith(precacheOrNetwork(event.request));
      break;
    case "cache-first":
      event.respondWith(cacheFirst(event.request, ASSET_CACHE));
      break;
    case "swr":
      event.respondWith(staleWhileRevalidate(event.request, API_CACHE));
      break;
    case "offline-queue":
      event.respondWith(handleRunCreate(event.request));
      break;
    default:
      // network-only: let the browser handle it
      break;
  }
});

async function precacheOrNetwork(request: Request): Promise<Response> {
  const cache = await caches.open(PRECACHE);
  let cached = await cache.match(request, { ignoreSearch: true });
  if (!cached && request.mode === "navigate") {
    cached = await cache.match("/index.html", { ignoreSearch: true });
  }
  if (cached) return cached;

  try {
    return await fetch(request);
  } catch {
    const offline = await cache.match("/offline.html", { ignoreSearch: true });
    return offline ?? new Response("Offline", { status: 503, statusText: "Offline" });
  }
}

async function cacheFirst(request: Request, name: string): Promise<Response> {
  const cache = await caches.open(name);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    await cache.put(request, response.clone());
  }
  return response;
}

async function staleWhileRevalidate(request: Request, name: string): Promise<Response> {
  const cache = await caches.open(name);
  const cached = await cache.match(request);

  const update = fetch(request)
    .then(async (response) => {
      if (response.ok) {
        await cache.put(request, response.clone());
        await notifyClients({ type: "CACHE_UPDATED", url: request.url });
      }
      return response;
    })
    .catch(() => cached);

  return cached ?? (await update) ?? new Response("Offline", { status: 503, statusText: "Offline" });
}

async function handleRunCreate(request: Request): Promise<Response> {
  const queueAndRespond = async () => {
    const entry = await queueRun(request);
    await notifyClients({ type: "RUN_QUEUED", id: entry.id, body: entry.body });
    return jsonResponse({ ok: true, queued: true, id: entry.id }, 202);
  };

  if (!self.navigator.onLine) {
    return queueAndRespond();
  }

  try {
    const response = await fetch(request.clone());
    if (!response.ok) {
      return queueAndRespond();
    }
    return response;
  } catch {
    return queueAndRespond();
  }
}

async function notifyClients(message: Record<string, unknown>): Promise<void> {
  const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  for (const client of clients) {
    client.postMessage(message);
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

self.addEventListener("message", (event) => {
  switch (event.data?.type) {
    case "SKIP_WAITING":
      self.skipWaiting();
      break;
    // Posted by register-sw.ts when the page comes back online (SW `online`
    // events are unreliable): drain the offline run queue now.
    case "DRAIN_QUEUE":
      event.waitUntil(replayQueue());
      break;
  }
});

self.addEventListener("sync", ((event: SyncEvent) => {
  if (event.tag === "at-run-queue") {
    event.waitUntil(replayQueue());
  }
}) as EventListener);

self.addEventListener("online", () => {
  void replayQueue();
});

async function replayQueue(): Promise<void> {
  const replayed = await drainQueue(async (body) =>
    fetch("/api/runs", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    }),
  );
  for (const entry of replayed) {
    await notifyClients({ type: "RUN_REPLAYED", id: entry.id, body: entry.body });
  }
}
