import type { JSX } from "solid-js";
import { createMemo, For, Show } from "solid-js";
import { AGENTS } from "../../agents/registry";
import type { RunRecord } from "../../run-store";
import { resolveStatusDirs } from "../../state-dir";
import { buildStateReportFor, type StateReport } from "../../status";
import { AGENT_HEALTH_CONFIG, type AgentHealthState } from "../../ui-spec";
import { summarizeUsage, type UsageSummary } from "../../usage/summary";
import { formatDuration as fmtPlanDur } from "../../usage/units";
import { durationMs, formatMs, formatRunRow, isToday, statusColor, successRateColor, TUI_COLORS } from "../format";
import { refreshTick } from "../store/auto-refresh";
import { filteredSessions2 } from "../store/filtered-sessions";
import { autoRefresh } from "../store/log";
import { taskBudgets } from "../store/sessions";
import { agent, tier } from "../store/settings";
import { buildAgentGroups, countRunsByAgent } from "./agents-model";

const RECENT_LIMIT = 8;

// Joined scope, same as `at status` and the sessions store.
const stateDirs = resolveStatusDirs();

export interface DashStats {
  total: number;
  running: RunRecord[];
  completed: RunRecord[];
  stuck: number;
  today: number;
  /** Percentage 0-100 of completed runs with exit code 0, or null when nothing has finished. */
  successRate: number | null;
  /** Mean run length over completed runs. */
  avgDurationMs: number;
}

/** Aggregate a (newest-first) run list into dashboard numbers. Pure. */
export function computeStats(runs: RunRecord[]): DashStats {
  const running = runs.filter((r) => r.status === "running");
  const completed = runs.filter((r) => r.status !== "running");
  const finished = completed.filter((r) => r.exitCode !== null);
  const ok = finished.filter((r) => r.exitCode === 0).length;

  return {
    total: runs.length,
    running,
    completed,
    stuck: runs.filter((r) => r.status === "stuck").length,
    today: runs.filter((r) => isToday(r.startedAt)).length,
    successRate: finished.length === 0 ? null : (ok / finished.length) * 100,
    avgDurationMs: finished.length === 0 ? 0 : finished.reduce((sum, r) => sum + durationMs(r), 0) / finished.length,
  };
}

// --- Agent panel (Dashboard mini-list) ---
//
// Shares the same vocabulary as the full Agents view: `AGENT_HEALTH_CONFIG`
// glyphs + the same health derivation (`agents-model.ts`), so the panel reads
// as the same data in compact form. `docs/layout.md` §2 fixes the panel
// order: Overview → Active runs → Agents → Recent completions.

/** "12 runs · 92%" / "0 runs · —". Driven by the row's pre-computed
 *  `successRatePct` (rounded integer or `null` when no finished runs exist). */
function dashboardGroupStats(runs: number, successRatePct: number | null): string {
  if (runs === 0) return "0 runs · —";
  const rate = successRatePct === null ? "—" : `${successRatePct}%`;
  return `${runs} runs · ${rate}`;
}

function colorForHealth(health: AgentHealthState): string {
  switch (health) {
    case "ok":
      return TUI_COLORS.ok;
    case "disabled":
      return TUI_COLORS.muted;
    case "failing":
      return TUI_COLORS.error;
  }
}

// No helper imports below the imports block — everything `computeStats` and
// `Dashboard` need from `format.ts` is already imported at the top.

/** Title row with consistent spacing underneath. */
function SectionHeader(props: { title: string }): JSX.Element {
  return (
    <box marginBottom={1}>
      <text fg={TUI_COLORS.accent}>
        <b>{props.title}</b>
      </text>
    </box>
  );
}

/** Padded, dim-bordered box for "nothing here yet" messages. */
function EmptyState(props: { message: string }): JSX.Element {
  return (
    <box borderColor={TUI_COLORS.dim} borderStyle="round" paddingX={2} paddingY={1} marginBottom={1}>
      <text fg={TUI_COLORS.dimmer} content={props.message} />
    </box>
  );
}

const pct = (r: number | null): string => (r === null ? "-" : `${Math.round(r * 100)}%`);

/** Two dashboard lines: consumed time, then planned-vs-consumed health. Pure. */
export function usageLines(u: UsageSummary): string[] {
  return [
    `time ${fmtPlanDur(u.ms)} · ${u.runs} finished runs`,
    u.tasksMetered === 0
      ? "tasks: none metered yet"
      : `tasks ${u.tasksMetered} metered · over budget ${u.tasksOverBudget} · time ${pct(u.timeRatio)} of plan`,
  ];
}

export function Dashboard(): JSX.Element {
  const stats = createMemo(() => computeStats(filteredSessions2()));
  const usage = createMemo(() => summarizeUsage(filteredSessions2(), taskBudgets()));
  const successText = createMemo(() => {
    const rate = stats().successRate;
    return rate === null ? "success: -" : `success: ${rate.toFixed(0)}%`;
  });
  // Same reports `at status` prints — joined across project `.at/` + `~/.at/`
  // when the project has its own scope, so agent health matches the run list.
  // `refreshTick` keeps the Agent panel in step with the 5-second poll (see
  // store/auto-refresh.ts). Without it, the panel would only refresh on a
  // run-list change.
  const health = createMemo((): StateReport => {
    refreshTick();
    return buildStateReportFor(stateDirs);
  });
  const agentGroups = createMemo<ReturnType<typeof buildAgentGroups>>(() => {
    refreshTick();
    return buildAgentGroups(AGENTS, countRunsByAgent(filteredSessions2()), health().agents);
  });
  // Single flat list for the panel — preserves the spec-tier order (1..4)
  // and alphabetical names within a tier.
  const agentRows = createMemo(() => agentGroups().flatMap((g) => g.agents));

  return (
    <box
      title="Dashboard"
      border
      borderStyle="single"
      borderColor={TUI_COLORS.border}
      flexDirection="column"
      flexGrow={1}
      padding={1}
    >
      <scrollbox flexGrow={1}>
        <box flexDirection="column" paddingX={1} paddingTop={1} gap={1}>
          {/* Overview */}
          <box>
            <SectionHeader title="Overview" />
            <box flexDirection="row" gap={3}>
              <text fg={TUI_COLORS.fg} content={`runs: ${stats().total}`} />
              <text fg={TUI_COLORS.ok} content={`active: ${stats().running.length}`} />
              <text fg={TUI_COLORS.warn} content={`stuck: ${stats().stuck}`} />
              <text fg={TUI_COLORS.fg} content={`today: ${stats().today}`} />
              <text fg={successRateColor(stats().successRate)} content={successText()} />
              <text fg={TUI_COLORS.fg} content={`avg: ${formatMs(stats().avgDurationMs)}`} />
            </box>
            <box marginTop={1}>
              <text
                fg={TUI_COLORS.muted}
                content={`  defaults: tier ${tier()} · agent ${agent()} · auto-refresh ${autoRefresh() ? "ON" : "OFF"}`}
              />
            </box>
          </box>

          {/* Consumed time + tokens, planned-vs-consumed for kanban tasks */}
          <box>
            <SectionHeader title="Usage" />
            <For each={usageLines(usage())}>{(line) => <text fg={TUI_COLORS.fg} content={`  ${line}`} />}</For>
          </box>

          {/* Active runs */}
          <box>
            <SectionHeader title={`Active runs (${stats().running.length})`} />
            <Show when={stats().running.length > 0} fallback={<EmptyState message="(nothing running)" />}>
              <box flexDirection="column">
                <For each={stats().running.slice(0, RECENT_LIMIT)}>
                  {(r) => <text fg={statusColor(r.status)} content={`  ${formatRunRow(r, { status: true })}`} />}
                </For>
              </box>
            </Show>
          </box>

          {/* Agents (compact) — same health glyphs/vocab as the Agents view. */}
          <box>
            <SectionHeader title="Agents" />
            <Show when={agentRows().length > 0} fallback={<EmptyState message="(no health records)" />}>
              <box flexDirection="column">
                <For each={agentRows()}>
                  {(row) => (
                    <box marginBottom={1}>
                      <text
                        fg={colorForHealth(row.health)}
                        content={`  ${AGENT_HEALTH_CONFIG[row.health].glyph} ${row.name} ${dashboardGroupStats(row.runs, row.successRatePct)}`}
                      />
                    </box>
                  )}
                </For>
              </box>
            </Show>
          </box>

          {/* Recent completions */}
          <box>
            <SectionHeader title="Recent completions" />
            <Show when={stats().completed.length > 0} fallback={<EmptyState message="(no finished runs)" />}>
              <box flexDirection="column">
                <For each={stats().completed.slice(0, RECENT_LIMIT)}>
                  {(r) => (
                    <text
                      fg={statusColor(r.status)}
                      content={`  ${formatRunRow(r, { status: true, exitCode: true })}`}
                    />
                  )}
                </For>
              </box>
            </Show>
          </box>
        </box>
      </scrollbox>
    </box>
  );
}
