import { createEffect } from "solid-js";
import { autoRefresh, refreshLog } from "./log";
import { refreshSessions } from "./sessions";

/**
 * Cadence of the shared run-list auto-refresh poll.
 *
 * 5s matches the historical default; the poll re-reads `runs.jsonl` under the
 * run lock (annotating dead/stuck processes) and tails the selected log.
 */
export const SESSION_POLL_MS = 5000;

/**
 * Shared auto-refresh loop: while the log store's `autoRefresh` flag is on,
 * poll sessions + the selected log on `SESSION_POLL_MS`.
 *
 * Call from component setup (it registers an effect owned by that root) and
 * pass the returned disposer to `onCleanup`. Returns the stop function so
 * callers can also stop explicitly (e.g. before tearing the renderer down).
 */
export function startSessionAutoRefresh(): () => void {
  let timer: ReturnType<typeof setInterval> | null = null;

  const stop = (): void => {
    if (timer === null) return;
    clearInterval(timer);
    timer = null;
  };

  createEffect(() => {
    const enabled = autoRefresh();
    stop();
    if (!enabled) return;
    timer = setInterval(() => {
      refreshSessions();
      refreshLog();
    }, SESSION_POLL_MS);
  });

  return stop;
}
