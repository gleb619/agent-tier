import { derived, writable } from "svelte/store";
import type { ApiRun } from "$types/api";
import { NAV_ITEMS, navMatchesQuery, runMatchesQuery } from "../../ui-spec";
import { runs } from "./runs";

export type StatusFilter = "all" | ApiRun["status"];

export const statusFilter = writable<StatusFilter>("all");
export const agentFilter = writable<string>("all");
export const searchQuery = writable<string>("");

/** runs filtered by status, agent and the shared `runMatchesQuery` predicate
 *  (whitespace tokens ANDed, each a substring of run id / name / agent / prompt). */
export const filteredRuns = derived(
  [runs, statusFilter, agentFilter, searchQuery],
  ([$runs, $status, $agent, $search]) =>
    $runs.filter((run) => {
      if ($status !== "all" && run.status !== $status) return false;
      if ($agent !== "all" && run.agent !== $agent) return false;
      if (!runMatchesQuery(run, $search)) return false;
      return true;
    }),
);

/** Nav items whose label + NAV_KEYWORDS aliases match the current searchQuery
 *  (docs/layout.md §1.1 — the sidebar filter narrows nav too). */
export const visibleNavItems = derived(searchQuery, ($search) =>
  NAV_ITEMS.filter((item) => navMatchesQuery(item.id, item.label, $search)),
);
