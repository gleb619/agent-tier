import type { JSX } from "solid-js";
import { createEffect, createMemo, For, Show } from "solid-js";
import { AGENTS } from "../../agents/registry";
import { resolveStatusDirs } from "../../state-dir";
import { type AgentHealthEntry, buildStateReportFor } from "../../status";
import { AGENT_HEALTH_CONFIG, type AgentHealthState } from "../../ui-spec";
import { refreshTick } from "../store/auto-refresh";
import { filteredSessions2 } from "../store/filtered-sessions";
import { agentsSelection, focusZone, setAgentsSelection, sidebarFilter } from "../store/ui";
import {
  type AgentGroup,
  type AgentRow,
  buildAgentGroups,
  countRunsByAgent,
  filterAgentGroupsByQuery,
} from "./agents-model";

const stateDirs = resolveStatusDirs();

/** Tier hues for headings (docs/layout.md §7: 1 purple · 2 blue · 3 amber ·
 *  4 gray). Inline hex keeps `format.ts` as the single source for TUI
 *  colours; mirrors the WebUI's tier hues. */
const TIER_HEADING_COLORS = {
  1: "#a371f7",
  2: "#58a6ff",
  3: "#d29922",
  4: "#8b949e",
} as const;

/** Same vocabulary as the WebUI `formatAgentRunStats`. Success rate uses
 *  the model's pre-computed 0-100 integer (or `null` for "—"). */
function formatRunStats(runs: number, successRatePct: number | null): string {
  if (runs === 0) return "0 runs · —";
  const rate = successRatePct === null ? "—" : `${successRatePct}%`;
  return `${runs} runs · ${rate}`;
}

/** Flat list of agent rows in display order: tier 1..4, alphabetical names. */
function flattenAgents(groups: AgentGroup[]): AgentRow[] {
  return groups.flatMap((group) => group.agents);
}

/** Pick an initial selection when the cursor is on the void. Returns the
 *  first row, or null when the list is empty (caller decides what to show). */
function firstAgentName(groups: AgentGroup[]): string | null {
  return flattenAgents(groups)[0]?.name ?? null;
}

/** Move the Agents-view cursor by `delta`, clamping at the ends. Uses the
 *  agent name (string) rather than index so a filter change that reshapes
 *  the list still keeps the cursor on the same agent when it's visible. */
export function moveAgentsCursor(delta: 1 | -1, groups: AgentGroup[]): void {
  const rows = flattenAgents(groups);
  if (rows.length === 0) {
    setAgentsSelection(null);
    return;
  }
  const current = agentsSelection();
  const curIdx = current ? rows.findIndex((r) => r.name === current) : -1;
  const nextIdx =
    curIdx === -1 ? (delta === 1 ? 0 : rows.length - 1) : Math.max(0, Math.min(rows.length - 1, curIdx + delta));
  setAgentsSelection(rows[nextIdx]?.name ?? null);
}

/** Resolve the currently-cursored row, or null when there's no cursor / the
 *  cursor's target was filtered away. Public so the keyboard handler can
 *  request it without reaching into the model. */
export function findSelectedAgent(groups: AgentGroup[]): { name: string; enabled: boolean } | null {
  const target = agentsSelection();
  const row = flattenAgents(groups).find((r) => r.name === target);
  if (!row) return null;
  return { name: row.name, enabled: row.enabled };
}

export function Agents(props: { focused: boolean }): JSX.Element {
  // `refreshTick` is the dep that pulls memo updates out of the 5-second
  // shared auto-refresh poll (auto-refresh.ts); without it the panel would
  // only refresh on a run-list change and a flipped enable toggle wouldn't
  // show up until the next `refreshSessions`.
  const statsMap = createMemo(() => {
    refreshTick();
    return countRunsByAgent(filteredSessions2());
  });
  const healthReport = createMemo((): AgentHealthEntry[] => {
    refreshTick();
    return buildStateReportFor(stateDirs).agents;
  });
  const groups = createMemo<AgentGroup[]>(() => {
    refreshTick();
    return filterAgentGroupsByQuery(buildAgentGroups(AGENTS, statsMap(), healthReport()), sidebarFilter());
  });

  // Whenever the visible set changes (sidebar filter narrows), keep the
  // cursor on the same agent — if that agent is gone, jump to the first
  // row. Done with `createEffect` (the result is a side effect, not a value).
  createEffect(() => {
    const allGroups = groups();
    const target = agentsSelection();
    const visible = flattenAgents(allGroups).some((r) => r.name === target);
    if (!target || !visible) {
      setAgentsSelection(firstAgentName(allGroups));
    }
  });

  return (
    <box
      title="Agents"
      border
      borderStyle="single"
      borderColor={props.focused ? "#00aaff" : "#555555"}
      focused={props.focused}
      flexDirection="column"
      flexGrow={1}
      padding={1}
    >
      <box marginBottom={1}>
        <text fg="#8b949e" content="↑/↓ or j/k to move   Enter/Space toggles enable   sidebar filter narrows by name" />
      </box>
      <scrollbox focused={focusZone() === "agents"} flexGrow={1}>
        <Show
          when={groups().some((g) => g.agents.length > 0)}
          fallback={
            <box paddingX={1} paddingY={1}>
              <text fg="#8b949e" content="(no agents match the current filter)" />
            </box>
          }
        >
          <box flexDirection="column" gap={1}>
            <For each={groups()}>
              {(group) => (
                <Show when={group.agents.length > 0}>
                  <box flexDirection="column">
                    <box marginBottom={1}>
                      <text fg={TIER_HEADING_COLORS[group.tier]} content={group.heading} />
                    </box>
                    <box flexDirection="column">
                      <For each={group.agents}>{(agent) => <AgentCard agent={agent} />}</For>
                    </box>
                  </box>
                </Show>
              )}
            </For>
          </box>
        </Show>
      </scrollbox>
    </box>
  );
}

function AgentCard(props: { agent: AgentRow }): JSX.Element {
  const selected = (): boolean => props.agent.name === agentsSelection();
  return (
    <box flexDirection="row" gap={2} paddingX={1} backgroundColor={selected() ? "#1c2128" : undefined}>
      <text fg={selected() ? "#58a6ff" : "#8b949e"}>{selected() ? "▶ " : "  "}</text>
      <text fg={healthColor(props.agent.health)}>{AGENT_HEALTH_CONFIG[props.agent.health].glyph}</text>
      <text fg={selected() ? "#c9d1d9" : "#c9d1d9"}>{`${props.agent.name}`.padEnd(11)}</text>
      <text fg="#58a6ff">{`t${props.agent.tier}`}</text>
      <text fg="#8b949e">{`${formatRunStats(props.agent.runs, props.agent.successRatePct)}`.padEnd(16)}</text>
      <text fg={props.agent.enabled ? "#3fb950" : "#f85149"}>
        {props.agent.enabled ? "[x] Enabled" : "[ ] Enabled"}
      </text>
      <Show when={!props.agent.enabled}>
        <text fg="#d29922" content={props.agent.health === "failing" ? "(failing)" : "(disabled)"} />
      </Show>
    </box>
  );
}

function healthColor(health: AgentHealthState): string {
  switch (health) {
    case "ok":
      return "#3fb950";
    case "disabled":
      return "#8b949e";
    case "failing":
      return "#f85149";
  }
}
