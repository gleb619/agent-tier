/**
 * Shared HTTP plumbing for the namer providers.
 *
 * Every provider needs the same three things around a request: a timeout that
 * aborts, the caller's `AbortSignal` forwarded into that abort, and a
 * guarantee the timer/listener are cleaned up. `fetchWithTimeout` owns that
 * dance so the providers only keep their own try/catch → `return null`
 * contract. Errors propagate to the caller.
 */

export interface FetchWithTimeoutOpts {
  timeoutMs: number;
  /** Caller-side cancellation; forwarded into the per-request controller. */
  signal: AbortSignal;
  fetchImpl: typeof fetch;
}

/** Forward `signal` aborts to `controller`. Returns an `off()` unsubscriber. */
export function linkAbort(signal: AbortSignal, controller: AbortController): () => void {
  if (!signal) return () => {};
  if (signal.aborted) {
    controller.abort();
    return () => {};
  }
  const onAbort = () => controller.abort();
  signal.addEventListener("abort", onAbort);
  return () => signal.removeEventListener("abort", onAbort);
}

/**
 * `fetchImpl(url, init)` with an aborting timeout and the caller's signal
 * linked in. `init.signal` is always replaced by the internal controller's.
 */
export async function fetchWithTimeout(url: string, init: RequestInit, opts: FetchWithTimeoutOpts): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
  const off = linkAbort(opts.signal, controller);
  try {
    return await opts.fetchImpl(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
    off();
  }
}
