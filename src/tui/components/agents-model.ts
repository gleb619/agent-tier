import { setDeactivated } from "../../health";
import type { RunRecord } from "../../run-store";
import { getStateFilePath, resolveStateDir } from "../../state-dir";
import type { AgentHealthEntry } from "../../status";
import type { AgentHealthState, Tier } from "../../ui-spec";
import { AGENT_HEALTH_CONFIG, AGENT_HEALTH_STATES, TIER_CONFIG, TIERS } from "../../ui-spec";

/**
 * Pure data layer for the TUI Agents view (docs/layout.md §5). Everything in
 * this module is renderer-free so the row model is unit-testable without a
 * TUI environment — keeps opentui imports out and matches the WebUI's split
 * between `webui/utils/agents.ts` and the Svelte components.
 */

// --- Health derivation (same rules as `webui/utils/agents.ts`) ---

/** Minimum input needed to derive an agent's health state. */
export interface AgentHealthInput {
  deactivated: boolean;
  disabledTo: string | null;
  failures: number;
}

/** Symptomatic health: failing wins over disabled (docs/layout.md §7). */
export function agentHealthState(input: AgentHealthInput): AgentHealthState {
  if (input.failures > 0) return "failing";
  if (!isAgentEnabled(input)) return "disabled";
  return "ok";
}

/** Treatment of the user toggle: `at enable|disable` is the only thing Agents
 *  toggles — the user toggle. Quota windows (`disabledTo`) clear on their own
 *  and out of scope here. Same predicate the WebUI uses (`isUserEnabled`). */
export function isAgentRowEnabled(input: Pick<AgentHealthInput, "deactivated"> | undefined): boolean {
  if (!input) return true;
  return !input.deactivated;
}

/** True when the agent would actually run: not deactivated AND not in a quota
 *  window. Used by the health predicate; not for the toggle UI. */
function isAgentEnabled(input: AgentHealthInput): boolean {
  return !input.deactivated && input.disabledTo === null;
}

/** Next toggle target. Pure — callers fire the async side effect. */
export function toggleIntent(agent: { enabled: boolean }): { enabled: boolean; intent: "enable" | "disable" } {
  if (agent.enabled) return { enabled: false, intent: "disable" };
  return { enabled: true, intent: "enable" };
}

// --- Agent row model ---

export interface AgentRowStats {
  runs: number;
  done: number;
  failed: number;
}

/** Stats keyed by agent name; an empty map means "no runs recorded". */
export type AgentRunStatsInput = ReadonlyMap<string, AgentRowStats>;

export interface AgentRow {
  name: string;
  tier: Tier;
  health: AgentHealthState;
  /** Glyph from `AGENT_HEALTH_CONFIG` for `health`. */
  glyph: string;
  runs: number;
  /** 0–100 rounded to integer, or null while no finished runs exist. */
  successRatePct: number | null;
  enabled: boolean;
}

export interface AgentGroup {
  tier: Tier;
  label: string;
  role: string;
  /** Pre-rendered heading for the tier block ("Tier 1 — architect / review"). */
  heading: string;
  agents: AgentRow[];
}

export interface AgentDefLike {
  name: string;
  tier: Tier;
}

/** Build the per-tier groups shown in the Agents view (docs/layout.md §5).
 *  Spec order is 1..4; tiers with zero agents still appear so the heading
 *  block stays stable when runs/health records come and go. */
export function buildAgentGroups(
  agents: ReadonlyArray<AgentDefLike>,
  runStats: AgentRunStatsInput,
  healthEntries: ReadonlyMap<string, AgentHealthEntry> | ReadonlyArray<AgentHealthEntry>,
): AgentGroup[] {
  const healthByName: ReadonlyMap<string, AgentHealthEntry> =
    healthEntries instanceof Map ? healthEntries : new Map(healthEntries.map((entry) => [entry.name, entry]));

  return TIERS.map((tier) => {
    const config = TIER_CONFIG[tier];
    const tierAgents = agents
      .filter((a) => a.tier === tier)
      .map<AgentRow>((agent) => {
        const health = healthByName.get(agent.name);
        const stats = runStats.get(agent.name);
        const derivedHealth: AgentHealthState = health
          ? agentHealthState({
              deactivated: health.deactivated,
              disabledTo: health.disabledTo,
              failures: health.failures,
            })
          : "ok";
        return {
          name: agent.name,
          tier,
          health: derivedHealth,
          glyph: AGENT_HEALTH_CONFIG[derivedHealth].glyph,
          runs: stats?.runs ?? 0,
          successRatePct: computeSuccessRate(stats),
          enabled: health ? isAgentRowEnabled(health) : true,
        };
      })
      // Stable display order: alphabetical by name, so the view matches the WebUI.
      .sort((a, b) => a.name.localeCompare(b.name));

    return {
      tier,
      label: config.label,
      role: config.role,
      heading: `${config.label} — ${config.role}`,
      agents: tierAgents,
    };
  });
}

function computeSuccessRate(stats: AgentRowStats | undefined): number | null {
  if (!stats) return null;
  const finished = stats.done + stats.failed;
  if (finished === 0) return null;
  return Math.round((stats.done / finished) * 100);
}

// --- Filter ---

/** Sidebar filter applied to the Agents view (docs/layout.md §1.1):
 *  case-insensitive name substring, AND across whitespace tokens, blank = all. */
export function filterAgentGroupsByQuery(groups: AgentGroup[], query: string): AgentGroup[] {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return groups;
  const matches = (name: string): boolean => {
    const haystack = name.toLowerCase();
    return tokens.every((token) => haystack.includes(token));
  };
  return groups
    .map((group) => ({ ...group, agents: group.agents.filter((a) => matches(a.name)) }))
    .filter((group) => group.agents.length > 0);
}

// Re-export the health-state vocab for callers that need to render the full set.
export { AGENT_HEALTH_STATES };

// --- Run counting (shared by both the Agents view and the Dashboard panel) ---

/** Count runs per agent name, plus the done/failed split behind the success
 *  rate. Mirrors `webui/utils/agents.ts#countRunsByAgent` so the TUI and WebUI
 *  show the same numbers. Running/stuck runs aren't counted in the success
 *  denominator (they're not finished yet). */
export function countRunsByAgent(runs: ReadonlyArray<RunRecord>): Map<string, AgentRowStats> {
  const map = new Map<string, AgentRowStats>();
  for (const run of runs) {
    const stats = map.get(run.agent) ?? { runs: 0, done: 0, failed: 0 };
    stats.runs += 1;
    if (run.status === "done") stats.done += 1;
    else if (run.status === "failed") stats.failed += 1;
    map.set(run.agent, stats);
  }
  return map;
}

// --- Dispatch (async side effect) ---

/** Apply the user toggle for one agent via the same backend `at enable|disable`
 *  uses (`setDeactivated` under the run lock). Writes target the resolved
 *  state dir (project `.at/` when it holds state, else `~/.at/`) — same path
 *  the CLI picks up via `getStateFilePath(resolveStateDir())`. */
export async function toggleAgentEnabled(name: string, desiredEnabled: boolean): Promise<void> {
  const stateFilePath = getStateFilePath(resolveStateDir());
  // setDeactivated(value: boolean) flips the `deactivated` flag: true ⇒
  // disabled, false ⇒ cleared. We want the agent enabled ⇔ deactivated=false.
  await setDeactivated(stateFilePath, name, !desiredEnabled);
}
