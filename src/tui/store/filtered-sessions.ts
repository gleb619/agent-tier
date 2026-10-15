import type { RunRecord } from "../../run-store";
import { runMatchesQuery } from "../../ui-spec";
import { sessions } from "./sessions";
import { sidebarFilter } from "./ui";

/**
 * Pure filter: keeps the runs that `runMatchesQuery` matches — whitespace
 * tokens ANDed, each a case-insensitive substring of run id, name, agent or
 * prompt. Input order preserved; a blank filter passes everything through.
 */
export function filterRuns(runs: RunRecord[], filter: string): RunRecord[] {
  if (!filter.trim()) return runs;
  return runs.filter((r) => runMatchesQuery(r, filter));
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
