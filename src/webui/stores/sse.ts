import { writable } from "svelte/store";
import { SseManager, type SseManagerOptions } from "../api/sse";
import { applySseEvent } from "./runs";

export const sseConnected = writable(false);
export const lastEventTime = writable<Date | null>(null);
export const connectionError = writable<string | null>(null);

export interface SseConnection {
  manager: SseManager;
  connect(): void;
  /** Force the connection-error state (wiring edge cases / tests). */
  fail(message: string): void;
  close(): void;
}

/**
 * Wire an SSE stream (`/api/events` or `/api/events/:runId`) to the sse +
 * runs stores: connection state → sseConnected/connectionError, each hub
 * event → lastEventTime + runs store status updates.
 */
export function createSseConnection(url: string, options: Partial<SseManagerOptions> = {}): SseConnection {
  const manager = new SseManager({
    url,
    onEvent: (event) => {
      lastEventTime.set(new Date());
      applySseEvent(event);
    },
    onStatus: (connected, error) => {
      sseConnected.set(connected);
      connectionError.set(connected ? null : (error ?? null));
    },
    ...options,
  });
  return {
    manager,
    connect: () => manager.connect(),
    fail: (message) => {
      sseConnected.set(false);
      connectionError.set(message);
    },
    close: () => {
      manager.close();
      sseConnected.set(false);
      connectionError.set(null);
    },
  };
}

/** Event types that change which runs exist / how they are labeled. */
const REFRESH_EVENT_TYPES = new Set(["start", "done", "error", "rename"]);

/**
 * Wire the app-wide `/api/events` stream: status folding (createSseConnection
 * glue) plus a refetch for events that introduce or relabel runs — a run
 * started elsewhere (CLI, API POST) is not yet in the store, and folding only
 * updates existing entries.
 */
export function startGlobalEvents(refetch: () => void, options: Partial<SseManagerOptions> = {}): SseConnection {
  return createSseConnection("/api/events", {
    onEvent: (event) => {
      lastEventTime.set(new Date());
      applySseEvent(event);
      if (REFRESH_EVENT_TYPES.has(event.type)) refetch();
    },
    ...options,
  });
}
