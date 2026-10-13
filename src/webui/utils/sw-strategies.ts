const CACHE_PREFIX = "at";

/** Surface version for cache purging on activate(). */
export const CACHE_VERSION = "v1";

export const SWR_API_PATHS = ["/api/runs", "/api/agents", "/api/stats", "/api/settings"];

/** Return a scoped cache name (e.g. `at-precache-v1`). */
export function cacheName(base: string): string {
  return `${CACHE_PREFIX}-${base}-${CACHE_VERSION}`;
}

export function isSameOrigin(url: URL, scope: string): boolean {
  return url.origin === new URL(scope, self.location.href).origin;
}

export function isImmutableAsset(url: URL): boolean {
  return url.pathname.startsWith("/assets/");
}

export function isApiPath(url: URL): boolean {
  return url.pathname.startsWith("/api/");
}

export function isSwrApiPath(url: URL): boolean {
  return SWR_API_PATHS.some((path) => url.pathname === path || url.pathname.startsWith(`${path}/`));
}

export function isEventStreamPath(url: URL): boolean {
  return url.pathname === "/api/events" || url.pathname.startsWith("/api/events/");
}

export function isRunCreateRequest(request: Request, url: URL): boolean {
  return request.method === "POST" && (url.pathname === "/api/runs" || url.pathname.startsWith("/api/runs/"));
}

export function isNavigationRequest(request: Request): boolean {
  return request.mode === "navigate";
}

export type SwStrategy = "precache" | "cache-first" | "swr" | "offline-queue" | "network";

export function chooseStrategy(request: Request, url: URL): SwStrategy {
  if (!isSameOrigin(url, "/")) return "network";
  if (request.method !== "GET") {
    if (isRunCreateRequest(request, url)) return "offline-queue";
    return "network";
  }
  if (isEventStreamPath(url)) return "network";
  if (isNavigationRequest(request)) return "precache";
  if (isImmutableAsset(url)) return "cache-first";
  if (isSwrApiPath(url)) return "swr";
  return "precache";
}
