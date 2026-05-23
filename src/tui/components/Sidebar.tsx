/** @jsxImportSource @opentui/solid */
import { For, Show, createMemo } from 'solid-js';
import { execSync } from 'child_process';
import {
  filteredSessions,
  selectedRunId,
  setSelectedRunId,
  sidebarFilter,
  setSidebarFilter,
  showDashboard,
  toggleDashboard,
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
      return '#3fb950';
    case 'done':
      return '#388bfd';
    case 'failed':
      return '#f85149';
    case 'stuck':
      return '#d29922';
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

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 1) + "…";
}

function selectSession(s: RunRecord): void {
  if (showDashboard()) {
    setShowDashboard(false);
  }
  setSelectedRunId(s.runId);
  setCurrentLogFile(s.logFile);
  loadLogFile(s.logFile);
}

interface SessionGroup {
  label: string;
  sessions: RunRecord[];
}

function getDateBucket(dateStr: string): string {
  const date = new Date(dateStr);
  const year = date.getFullYear();
  const month = date.getMonth();
  const day = date.getDate();

  const today = new Date();
  const todayYear = today.getFullYear();
  const todayMonth = today.getMonth();
  const todayDay = today.getDate();

  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayYear = yesterday.getFullYear();
  const yesterdayMonth = yesterday.getMonth();
  const yesterdayDay = yesterday.getDate();

  if (year === todayYear && month === todayMonth && day === todayDay) {
    return 'Today';
  }
  if (year === yesterdayYear && month === yesterdayMonth && day === yesterdayDay) {
    return 'Yesterday';
  }

  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${day} ${months[month]}`;
}

function groupSessionsByDate(sessions: RunRecord[]): SessionGroup[] {
  const groups: SessionGroup[] = [];
  let currentLabel: string | null = null;
  let currentGroup: SessionGroup | null = null;

  for (let i = 0; i < sessions.length; i++) {
    const session = sessions[i];
    const label = getDateBucket(session.startedAt);
    if (label !== currentLabel) {
      if (currentGroup) {
        groups.push(currentGroup);
      }
      currentLabel = label;
      currentGroup = { label, sessions: [session] };
    } else if (currentGroup) {
      currentGroup.sessions.push(session);
    }
  }

  if (currentGroup) {
    groups.push(currentGroup);
  }

  return groups;
}

function StatusDashboard(): JSX.Element {
  try {
    const output = execSync('at status', { encoding: 'utf8', timeout: 5000 });
    const lines = output.split('\n').filter((l) => l.trim());
    return (
      <box flexDirection="column" flexGrow={1} padding={1}>
        <text content="── Dashboard ──" fg="#58a6ff" marginY={0} />
        <scrollbox flexGrow={1}>
          <For each={lines}>
            {(line) => <text content={line} fg="#c9d1d9" />}
          </For>
        </scrollbox>
      </box>
    );
  } catch {
    return (
      <box flexDirection="column" flexGrow={1} padding={1}>
        <text content="Dashboard unavailable" fg="#f85149" />
      </box>
    );
  }
}

export function Sidebar(props: SidebarProps): JSX.Element {
  const groups = createMemo(() => groupSessionsByDate(filteredSessions()));

  return (
    <box
      title="Sessions"
      border
      borderStyle="single"
      borderColor="#21262d"
      focusedBorderColor="#1f6feb"
      focused={props.focused}
      flexDirection="column"
      flexGrow={1}
      width="25%"
      maxWidth="30%"
      padding={1}
    >
      <input
        value={sidebarFilter()}
        placeholder="filter..."
        focused={props.focusZone === 0}
        onInput={(v: string) => setSidebarFilter(v)}
        width="100%"
      />

      <Show when={showDashboard()}>
        <StatusDashboard />
      </Show>

      <Show when={!showDashboard()}>
        <scrollbox flexGrow={1}>
          <text
            content={showDashboard() ? '◀ Back to sessions' : '📊 Dashboard (status)'}
            fg="#58a6ff"
            onMouseDown={toggleDashboard}
            marginY={0}
          />
          <For each={groups()}>
            {(group) => (
              <>
                <text content={'── ' + group.label + ' ──'} fg="#484f58" marginY={0} />
                <For each={group.sessions}>
                  {(s) => {
                    const isSelected = selectedRunId() === s.runId;
                    return (
                      <box
                        flexDirection="column"
                        paddingY={0}
                        paddingX={1}
                        backgroundColor={isSelected ? '#1c2128' : '#0d1117'}
                        onMouseDown={() => selectSession(s)}
                      >
                        <text>
                          {isSelected ? '▶ ' : '  '}{statusIcon(s.status)} {truncate(s.runId, 20)}
                        </text>
                        <text fg="#8b949e">
                          {s.agent} t{s.tier} · {formatDuration(s)}
                        </text>
                      </box>
                    );
                  }}
                </For>
              </>
            )}
          </For>
        </scrollbox>
      </Show>
    </box>
  );
}