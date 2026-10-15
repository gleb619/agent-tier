import { derived, get } from "svelte/store";
import { countRunsByAgent } from "$utils/agents";
import { setAgentEnabled } from "../api/agents";
import { agents } from "./dashboard";
import { runs } from "./runs";

/** Run counters per agent name, recomputed whenever the runs store changes. */
export const agentRunStats = derived(runs, ($runs) => countRunsByAgent($runs));

/**
 * Toggle an agent through `PUT /api/agents/:name/enable|disable`.
 *
 * The row flips immediately (optimistic) and rolls back when the request
 * fails — the caller surfaces the error. `deactivated` is the flag `at
 * enable|disable` writes; `disabledTo` (a quota window) is left to the backend.
 */
export async function toggleAgentEnabled(name: string, enabled: boolean): Promise<void> {
  const before = get(agents);
  agents.update((list) => list.map((agent) => (agent.name === name ? { ...agent, deactivated: !enabled } : agent)));
  try {
    await setAgentEnabled(name, enabled);
  } catch (err) {
    agents.set(before);
    throw err;
  }
}
