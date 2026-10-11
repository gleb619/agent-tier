import type { RunRecord } from "../../run-store";
import { sessions } from "./sessions";
import { sidebarFilter } from "./ui";

/**
 * Pure filter: case-insensitive substring match on run id, agent, or prompt.
 */
export function filterRuns(runs: RunRecord[], filter: string): RunRecord[] {
  const needle = filter.trim().toLowerCase();
  if (!needle) return runs;
  return runs.filter(
    (r) =>
      r.runId.toLowerCase().includes(needle) ||
      r.agent.toLowerCase().includes(needle) ||
      r.prompt.toLowerCase().includes(needle),
  );
}

/**
 * TUI run list — sessions from the store, sidebarFilter from this store.
 *
 * Deliberately a function, not a module-level `createMemo`: a computation
 * created outside any `createRoot` never re-runs when its sources change, so
 * it would freeze at whatever the run list was at import time. Callers read it
 * inside their own (rooted) memos and pick up both signals reactively.
 */
export function filteredSessions2(): RunRecord[] {
  return filterRuns(sessions(), sidebarFilter());
}
