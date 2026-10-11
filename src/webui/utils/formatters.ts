import type { ApiRun } from "$types/api";

const MINUTE = 60;
const HOUR = 3600;

/** Compact duration: "12s", "1m 23s", "12h 34m" (seconds dropped past an hour). */
export function formatDuration(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return "—";
  const s = Math.floor(totalSeconds);
  if (s < MINUTE) return `${s}s`;
  if (s < HOUR) {
    const m = Math.floor(s / MINUTE);
    const rem = s % MINUTE;
    return `${m}m ${String(rem).padStart(2, "0")}s`;
  }
  const h = Math.floor(s / HOUR);
  const m = Math.floor((s % HOUR) / MINUTE);
  return `${h}h ${String(m).padStart(2, "0")}m`;
}

/** Elapsed seconds of a run: finishedAt − startedAt, or now − startedAt while running. */
export function runDurationSeconds(run: Pick<ApiRun, "startedAt" | "finishedAt">, now: Date = new Date()): number {
  const end = run.finishedAt ? new Date(run.finishedAt).getTime() : now.getTime();
  return Math.max(0, Math.floor((end - new Date(run.startedAt).getTime()) / 1000));
}
