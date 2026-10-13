import type { ViewType } from "$types/index";
import { viewModules } from "$utils/router";

const pending = new Map<ViewType, Promise<unknown>>();

/** Forget cached prefetch promises (test isolation). */
export function clearPrefetches(): void {
  pending.clear();
}

/**
 * Warm the module cache for a lazy view chunk (dynamic import resolved and
 * cached by the browser). Deduped per view; failures are swallowed — a
 * failed prefetch must not surface errors, the real navigation retries.
 */
export function prefetchView(view: ViewType): Promise<unknown> {
  const existing = pending.get(view);
  if (existing) return existing;
  const promise = Promise.resolve()
    .then(() => viewModules[view]())
    .catch(() => {});
  pending.set(view, promise);
  return promise;
}

interface IdleWindow {
  requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
  cancelIdleCallback?: (id: number) => void;
}

/**
 * Schedule low-priority prefetch of the given views (default: all lazy
 * views) via requestIdleCallback, falling back to a plain timeout off the
 * main thread. Returns a cancel function (noop where scheduling failed).
 */
export function prefetchViewsOnIdle(views: ViewType[], timeoutMs = 2000): () => void {
  const win = (globalThis as { window?: IdleWindow }).window;
  const idle = win?.requestIdleCallback;
  if (!idle) {
    const timer = setTimeout(() => {
      for (const view of views) void prefetchView(view);
    }, 0);
    return () => clearTimeout(timer);
  }
  const id = idle.call(
    win,
    () => {
      for (const view of views) void prefetchView(view);
    },
    { timeout: timeoutMs },
  );
  const cancel = win.cancelIdleCallback;
  return () => {
    if (cancel) cancel.call(win, id);
    else clearTimeout(id);
  };
}
