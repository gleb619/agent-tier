import { For, Show, createMemo } from 'solid-js';
import type { JSX } from 'solid-js';
import type { RunRecord } from '../../run-store';
import { buildStateReport, type StateReport } from '../../status';
import { resolveStateDir } from '../../state-dir';
import { autoRefresh } from '../../tui/store/log';
import { agent, tier } from '../../tui/store/settings';
import { filteredSessions2 } from '../store/filtered-sessions';
import {
  durationMs,
  formatAgentRow,
  formatMs,
  formatRunRow,
  isToday,
  statusColor,
  TUI2_COLORS,
} from '../format';

const RECENT_LIMIT = 8;

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
  const running = runs.filter((r) => r.status === 'running');
  const completed = runs.filter((r) => r.status !== 'running');
  const finished = completed.filter((r) => r.exitCode !== null);
  const ok = finished.filter((r) => r.exitCode === 0).length;

  return {
    total: runs.length,
    running,
    completed,
    stuck: runs.filter((r) => r.status === 'stuck').length,
    today: runs.filter((r) => isToday(r.startedAt)).length,
    successRate: finished.length === 0 ? null : (ok / finished.length) * 100,
    avgDurationMs: finished.length === 0 ? 0 : finished.reduce((sum, r) => sum + durationMs(r), 0) / finished.length,
  };
}

// No helper imports below the imports block — everything `computeStats` and
// `Dashboard` need from `format.ts` is already imported at the top.

/** Title row with consistent spacing underneath. */
function SectionHeader(props: { title: string }): JSX.Element {
  return (
    <box marginBottom={1}>
      <text fg={TUI2_COLORS.accent}>
        <b>{props.title}</b>
      </text>
    </box>
  );
}

/** Padded, dim-bordered box for "nothing here yet" messages. */
function EmptyState(props: { message: string }): JSX.Element {
  return (
    <box
      borderColor={TUI2_COLORS.dim}
      borderStyle="round"
      paddingX={2}
      paddingY={1}
      marginBottom={1}
    >
      <text fg={TUI2_COLORS.dimmer} content={props.message} />
    </box>
  );
}

export function Dashboard(): JSX.Element {
  const stats = createMemo(() => computeStats(filteredSessions2()));
  const successText = createMemo(() => {
    const rate = stats().successRate;
    return rate === null ? 'success: -' : `success: ${rate.toFixed(0)}%`;
  });
  // Same reports `at status` prints; cheap to rebuild from the state file.
  const health = createMemo((): StateReport => buildStateReport(resolveStateDir()));

  return (
    <box
      title="Dashboard"
      border
      borderStyle="single"
      borderColor={TUI2_COLORS.border}
      flexDirection="column"
      flexGrow={1}
      padding={1}
    >
      <scrollbox flexGrow={1}>
        <box flexDirection="column" paddingX={1} paddingTop={1} gap={1}>
          {/* Quick stats */}
          <box>
            <SectionHeader title="Quick stats" />
            <box flexDirection="row" gap={3}>
              <text fg={TUI2_COLORS.fg} content={`runs: ${stats().total}`} />
              <text fg={TUI2_COLORS.ok} content={`active: ${stats().running.length}`} />
              <text fg={TUI2_COLORS.warn} content={`stuck: ${stats().stuck}`} />
              <text fg={TUI2_COLORS.fg} content={`today: ${stats().today}`} />
              <text fg={TUI2_COLORS.fg} content={successText()} />
              <text fg={TUI2_COLORS.fg} content={`avg: ${formatMs(stats().avgDurationMs)}`} />
            </box>
          </box>

          {/* Active runs */}
          <box>
            <SectionHeader title={`Active runs (${stats().running.length})`} />
            <Show
              when={stats().running.length > 0}
              fallback={<EmptyState message="(nothing running)" />}
            >
              <box flexDirection="column">
                <For each={stats().running.slice(0, RECENT_LIMIT)}>
                  {(r) => (
                    <text
                      fg={statusColor(r.status)}
                      content={`  ${formatRunRow(r, { status: true })}`}
                    />
                  )}
                </For>
              </box>
            </Show>
          </box>

          {/* Recent completions */}
          <box>
            <SectionHeader title="Recent completions" />
            <Show
              when={stats().completed.length > 0}
              fallback={<EmptyState message="(no finished runs)" />}
            >
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

          {/* Agents */}
          <box>
            <SectionHeader title="Agents" />
            <text
              fg={TUI2_COLORS.muted}
              content={`  defaults: tier ${tier()} · agent ${agent()} · auto-refresh ${autoRefresh() ? 'ON' : 'OFF'}`}
            />
            <Show
              when={health().agents.length > 0}
              fallback={<EmptyState message="(no health records)" />}
            >
              <box flexDirection="column">
                <For each={health().agents}>
                  {(a) => (
                    <box marginBottom={a.deactivated ? 1 : 0}>
                      <text
                        fg={a.deactivated ? TUI2_COLORS.error : TUI2_COLORS.ok}
                        content={`  ${formatAgentRow(a)}`}
                      />
                    </box>
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
