export interface Debounced<A extends unknown[]> {
  (...args: A): void;
  /** Cancel any pending trailing invocation. */
  cancel(): void;
}

/**
 * Trailing-edge debounce: the wrapped function fires once `waitMs` after the
 * last call. Bursts (e.g. a stream of SSE events each triggering a refetch)
 * collapse into a single invocation.
 */
export function debounce<A extends unknown[]>(fn: (...args: A) => void, waitMs: number): Debounced<A> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastArgs: A | null = null;
  const wrapped = (...args: A) => {
    lastArgs = args;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      const call = lastArgs;
      lastArgs = null;
      if (call) fn(...call);
    }, waitMs);
  };
  wrapped.cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    lastArgs = null;
  };
  return wrapped;
}
