import { derived, writable } from "svelte/store";
import type { ApiRun } from "$types/api";
import { runs } from "./runs";

export type StatusFilter = "all" | ApiRun["status"];

export const statusFilter = writable<StatusFilter>("all");
export const agentFilter = writable<string>("all");
export const searchQuery = writable<string>("");

/** runs filtered by status, agent and a case-insensitive search over name/prompt/runId. */
export const filteredRuns = derived(
  [runs, statusFilter, agentFilter, searchQuery],
  ([$runs, $status, $agent, $search]) => {
    const q = $search.trim().toLowerCase();
    return $runs.filter((run) => {
      if ($status !== "all" && run.status !== $status) return false;
      if ($agent !== "all" && run.agent !== $agent) return false;
      if (q && !`${run.name}\n${run.prompt}\n${run.runId}`.toLowerCase().includes(q)) return false;
      return true;
    });
  },
);
