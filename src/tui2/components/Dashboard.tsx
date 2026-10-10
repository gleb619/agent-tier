import { For, Show, createMemo } from 'solid-js';
import type { JSX } from 'solid-js';
import type { RunRecord } from '../../run-store';
import { buildStateReport, type StateReport } from '../../status';
import { resolveStateDir } from '../../state-dir';
import { autoRefresh } from '../../tui/store/log';
import { agent, tier } from '../../tui/store/settings';
import { filteredSessions2 } from '../store/filtered-sessions';
import { durationMs, formatMs, isToday, statusColor, statusIcon, truncate } from '../format';

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

function Section(props: { title: string; children?: JSX.Element }): JSX.Element {
  return (
    <>
      <text fg="#58a6ff">
        <b>{props.title}</b>
      </text>
      <text content="" />
      {props.children}
    </>
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
      borderColor="#555555"
      flexDirection="column"
      flexGrow={1}
      padding={1}
    >
      <scrollbox flexGrow={1}>
        <box flexDirection="column" paddingX={1}>
          <Section title="Quick stats">
            <box flexDirection="row" gap={3}>
              <text fg="#c9d1d9" content={`runs: ${stats().total}`} />
              <text fg="#3fb950" content={`active: ${stats().running.length}`} />
              <text fg="#d29922" content={`stuck: ${stats().stuck}`} />
              <text fg="#c9d1d9" content={`today: ${stats().today}`} />
              <text fg="#c9d1d9" content={successText()} />
              <text fg="#c9d1d9" content={`avg: ${formatMs(stats().avgDurationMs)}`} />
            </box>
          </Section>

          <Section title={`Active runs (${stats().running.length})`}>
            <Show
              when={stats().running.length > 0}
              fallback={<text fg="#484f58" content="  (nothing running)" />}
            >
              <For each={stats().running.slice(0, RECENT_LIMIT)}>
                {(r) => (
                  <text
                    fg={statusColor(r.status)}
                    content={`  ${statusIcon(r.status)} ${truncate(r.runId, 20)}  ${r.agent.padEnd(12)} ${formatMs(durationMs(r))}`}
                  />
                )}
              </For>
            </Show>
          </Section>

          <Section title="Recent completions">
            <Show
              when={stats().completed.length > 0}
              fallback={<text fg="#484f58" content="  (no finished runs)" />}
            >
              <For each={stats().completed.slice(0, RECENT_LIMIT)}>
                {(r) => (
                  <text
                    fg={statusColor(r.status)}
                    content={`  ${statusIcon(r.status)} ${truncate(r.runId, 20)}  ${r.agent.padEnd(12)} ${r.status.padEnd(8)} code ${r.exitCode ?? '-'}  ${formatMs(durationMs(r))}`}
                  />
                )}
              </For>
            </Show>
          </Section>

          <Section title="Agents">
            <text fg="#8b949e" content={`  defaults: tier ${tier()} · agent ${agent()} · auto-refresh ${autoRefresh() ? 'ON' : 'OFF'}`} />
            <Show
              when={health().agents.length > 0}
              fallback={<text fg="#484f58" content="  (no health records)" />}
            >
              <For each={health().agents}>
                {(a) => (
                  <text
                    fg={a.deactivated ? '#f85149' : '#3fb950'}
                    content={`  ${a.deactivated ? '✗' : '✓'} ${a.name.padEnd(12)} failures ${a.failures}${a.deactivated ? '  (disabled)' : ''}`}
                  />
                )}
              </For>
            </Show>
          </Section>
        </box>
      </scrollbox>
    </box>
  );
}
