import type { ApiAgent, ApiRun } from "$types/api";
import { type AgentHealthState, TIERS, type Tier } from "../../ui-spec";
import { formatDuration } from "./formatters";

/** Per-agent run counters shown on the Agents cards (docs/layout.md §5). */
export interface AgentRunStats {
  runs: number;
  done: number;
  failed: number;
}

/** Enable flag as served by the API: `at disable` (deactivated) and a quota
 *  window (`disabledTo`) both take the agent out of rotation. Same predicate
 *  the dashboard Agents panel uses. */
export function isAgentEnabled(agent: Pick<ApiAgent, "deactivated" | "disabledTo">): boolean {
  return !agent.deactivated && agent.disabledTo === null;
}

/** The user switch `at enable|disable` writes: `deactivated`. Kept apart from
 *  `isAgentEnabled` so the Agents toggle only ever changes what the endpoint
 *  can actually change — a quota window (`disabledTo`) clears on its own. */
export function isUserEnabled(agent: Pick<ApiAgent, "deactivated">): boolean {
  return !agent.deactivated;
}

/** "blocked for 12m" while a quota window is still running, else null. */
export function blockedUntilLabel(disabledTo: string | null, now: Date = new Date()): string | null {
  if (disabledTo === null) return null;
  const until = new Date(disabledTo).getTime();
  if (!Number.isFinite(until)) return null;
  const seconds = Math.floor((until - now.getTime()) / 1000);
  return seconds > 0 ? `blocked for ${formatDuration(seconds)}` : null;
}

/** Health glyph state (docs/layout.md §7). Consecutive failures win over the
 *  disabled flag — they stay a problem signal for an agent that is switched off. */
export function agentHealth(agent: Pick<ApiAgent, "deactivated" | "disabledTo" | "failures">): AgentHealthState {
  if (agent.failures > 0) return "failing";
  if (!isAgentEnabled(agent)) return "disabled";
  return "ok";
}

/** Count runs per agent name, plus the done/failed split behind the success rate. */
export function countRunsByAgent(runs: readonly Pick<ApiRun, "agent" | "status">[]): Map<string, AgentRunStats> {
  const byAgent = new Map<string, AgentRunStats>();
  for (const run of runs) {
    const stats = byAgent.get(run.agent) ?? { runs: 0, done: 0, failed: 0 };
    stats.runs += 1;
    if (run.status === "done") stats.done += 1;
    else if (run.status === "failed") stats.failed += 1;
    byAgent.set(run.agent, stats);
  }
  return byAgent;
}

/** "12 runs · 92%"; the rate stays "—" until the agent has finished runs
 *  (same done/(done+failed) definition as the dashboard success card). */
export function formatAgentRunStats(stats: AgentRunStats | undefined): string {
  if (stats === undefined) return "0 runs · —";
  const finished = stats.done + stats.failed;
  const rate = finished === 0 ? "—" : `${Math.round((stats.done / finished) * 100)}%`;
  return `${stats.runs} runs · ${rate}`;
}

/** Header filter of the Agents view (docs/layout.md §5): a name substring plus
 *  an optional tier. `tier` 0 means "all tiers"; a blank query matches all. */
export function filterAgents(agents: readonly ApiAgent[], query: string, tier = 0): ApiAgent[] {
  const needle = query.trim().toLowerCase();
  return agents.filter((agent) => {
    if (tier !== 0 && agent.tier !== tier) return false;
    return needle === "" || agent.name.toLowerCase().includes(needle);
  });
}

/** Agents grouped per tier 1..4 (spec order), sorted by name, empty tiers dropped. */
export function groupAgentsByTier(agents: readonly ApiAgent[]): { tier: Tier; agents: ApiAgent[] }[] {
  const byName = (a: ApiAgent, b: ApiAgent) => a.name.localeCompare(b.name);
  return TIERS.map((tier) => ({ tier, agents: agents.filter((a) => a.tier === tier).sort(byName) })).filter(
    (group) => group.agents.length > 0,
  );
}
