/** @jsxImportSource @opentui/solid */
import { For, Show } from 'solid-js';
import {
  filteredSessions,
  selectedRunId,
  setSelectedRunId,
  sidebarFilter,
  setSidebarFilter,
} from '../store/sessions';
import { setCurrentLogFile, loadLogFile } from '../store/log';
import type { RunRecord } from '../../run-store';

interface SidebarProps {
  focused: boolean;
  focusZone: 0 | 1;
}

function statusIcon(status: RunRecord['status']): string {
  switch (status) {
    case 'running':
      return '●';
    case 'done':
      return '✓';
    case 'failed':
      return '✗';
    case 'stuck':
      return '⚠';
  }
}

function statusColor(status: RunRecord['status']): string {
  switch (status) {
    case 'running':
      return '#00ff88';
    case 'done':
      return '#00aaff';
    case 'failed':
      return '#ff4444';
    case 'stuck':
      return '#ffaa00';
  }
}

function formatDuration(r: RunRecord): string {
  const start = new Date(r.startedAt).getTime();
  const end = r.finishedAt ? new Date(r.finishedAt).getTime() : Date.now();
  const diff = Math.floor((end - start) / 1000);
  const mins = Math.floor(diff / 60);
  const secs = diff % 60;
  if (mins > 0) {
    return `${mins}m ${secs}s`;
  }
  return `${secs}s`;
}

function selectSession(s: RunRecord): void {
  setSelectedRunId(s.runId);
  setCurrentLogFile(s.logFile);
  loadLogFile(s.logFile);
}

export function Sidebar(props: SidebarProps): JSX.Element {
  return (
    <box
      title="Sessions"
      border
      borderStyle="single"
      borderColor="#555555"
      focusedBorderColor="#00aaff"
      focused={props.focused}
      flexDirection="column"
      flexGrow={1}
      padding={1}
    >
      <input
        value={sidebarFilter()}
        placeholder="filter sessions..."
        focused={props.focusZone === 0}
        onInput={(v: string) => setSidebarFilter(v)}
        width="100%"
      />
      <scrollbox flexGrow={1}>
        <For each={filteredSessions()}>
          {(s) => {
            const isSelected = selectedRunId() === s.runId;
            return (
              <box
                flexDirection="column"
                padding={1}
                backgroundColor={isSelected ? '#1a2a3a' : '#111111'}
                onMouseDown={() => selectSession(s)}
              >
                <text>
                  {statusIcon(s.status)} {s.runId.slice(0, 16)}
                </text>
                <text fg="#888888">
                  {s.agent} t{s.tier}
                </text>
                <text fg={statusColor(s.status)}>
                  {s.status} {formatDuration(s)}
                </text>
              </box>
            );
          }}
        </For>
      </scrollbox>
      <Show when={selectedRunId() !== null}>
        <box>
          <text fg="#555555">^K kill  ^E retry</text>
        </box>
      </Show>
    </box>
  );
}