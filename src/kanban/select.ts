import {
  blank,
  DEFAULT_STATUS,
  DONE,
  IN_PROGRESS,
  numericId,
  PRIORITY_ORDER,
  type Task,
  UNKNOWN_PRIORITY,
} from "./types";

export interface Selection {
  type: "current" | "next";
  task: Task;
}

/** Unknown blocker IDs are ignored on purpose: a stale reference must not freeze the board. */
export function isUnblocked(task: Task, all: Task[]): boolean {
  const raw = task["Blocked By"] ?? "";
  if (blank(raw)) return true;
  const blockers = raw.split(/[,\s]+/).filter(Boolean);
  for (const blockerId of blockers) {
    const dep = all.find((t) => t.ID === blockerId);
    if (!dep) continue;
    if (dep.Status !== DONE) return false;
  }
  return true;
}

/**
 * Pure and totally ordered — the same board always yields the same answer, which is
 * what makes an autonomous loop crash-resumable and reproducible.
 */
export function nextExecutable(tasks: Task[]): Selection | null {
  const inProgress = tasks.find((t) => t.Status === IN_PROGRESS);
  if (inProgress) return { type: "current", task: inProgress };

  const candidates = tasks.filter((t) => t.Status === DEFAULT_STATUS && isUnblocked(t, tasks));
  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    const pa = PRIORITY_ORDER[a.Priority] ?? UNKNOWN_PRIORITY;
    const pb = PRIORITY_ORDER[b.Priority] ?? UNKNOWN_PRIORITY;
    if (pa !== pb) return pa - pb;
    return numericId(a.ID) - numericId(b.ID);
  });

  return { type: "next", task: candidates[0] };
}
