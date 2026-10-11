import { derived, writable } from "svelte/store";
import type { ApiRun, NotifyEvent } from "$types/api";

/** All runs, newest first (as served by GET /api/runs). */
export const runs = writable<ApiRun[]>([]);

export const activeRuns = derived(runs, ($runs) => $runs.filter((r) => r.status === "running"));
export const completedRuns = derived(runs, ($runs) => $runs.filter((r) => r.status === "done" || r.status === "failed"));

export const selectedRunId = writable<string | null>(null);
/** The selected run, kept fresh against `runs` (null when missing or nothing selected). */
export const selectedRun = derived([runs, selectedRunId], ([$runs, $id]) => $runs.find((r) => r.runId === $id) ?? null);

export function selectRun(runId: string | null): void {
  selectedRunId.set(runId);
}

function byNewestFirst(a: ApiRun, b: ApiRun): number {
  return new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime();
}

export function setRuns(list: ApiRun[]): void {
  runs.set([...list].sort(byNewestFirst));
}

export function upsertRun(run: ApiRun): void {
  runs.update((list) => {
    const idx = list.findIndex((r) => r.runId === run.runId);
    if (idx === -1) return [...list, run].sort(byNewestFirst);
    const next = [...list];
    next[idx] = run;
    return next;
  });
}

/**
 * Fold a hub SSE event into the runs store. Status-bearing event types update
 * the matching run (by exact id or prefix — scoped ids keep the full runId);
 * message/tool/progress/... only refresh via refetch and change nothing here.
 */
export function applySseEvent(event: NotifyEvent): void {
  const status: ApiRun["status"] | undefined =
    event.type === "start" ? "running" : event.type === "done" ? "done" : event.type === "error" ? "failed" : undefined;
  if (!status) return;
  runs.update((list) =>
    list.map((run) => {
      if (run.runId !== event.runId && !run.runId.startsWith(event.runId)) return run;
      const finished = status === "done" || status === "failed";
      return {
        ...run,
        status,
        finishedAt: finished ? (run.finishedAt ?? event.ts) : run.finishedAt,
        exitCode: finished && run.exitCode === null ? (readExitCode(event) ?? run.exitCode) : run.exitCode,
      };
    }),
  );
}

function readExitCode(event: NotifyEvent): number | null {
  const code = event.data?.["exitCode"];
  return typeof code === "number" ? code : null;
}
