import { For, createMemo } from 'solid-js';
import {
  filteredSessions,
  selectedRunId,
  setSelectedRunId,
  sidebarFilter,
  setSidebarFilter,
  showDashboard,
  setShowDashboard,
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

export function Sidebar(props: SidebarProps): JSX.Element {
  const groups = createMemo(() => groupSessionsByDate(filteredSessions()));

  return (
    <box
      title="Sessions"
      border
      borderStyle="single"
      borderColor={props.focused ? (props.focusZone === 1 ? "#00ddff" : "#00aaff") : "#555555"}
      focused={props.focused}
      flexDirection="column"
      flexGrow={1}
      padding={1}
    >
      {/* TODO: add here support of arrows navigation for list(e.g. if input active, we still need to navigate in list) */}
      <input
        value={sidebarFilter()}
        placeholder="filter..."
        focused={props.focusZone === 0}
        onInput={(v: string) => setSidebarFilter(v)}
        width="100%"
      />

      <text content="───────────────────────────" fg={props.focusZone === 0 ? "#00aaff" : "#555555"} />

      <scrollbox flexGrow={1}>
        <box
          flexDirection="column"
          paddingY={0}
          paddingX={1}
          backgroundColor={showDashboard() && '#1c2128'}
          onMouseDown={() => { setShowDashboard(true); setSelectedRunId(null); }}
        >
          <text fg="#58a6ff">
            {showDashboard() ? '▶ ' : '  '}📊 Dashboard
          </text>
        </box>

        <text content="───────────────────────────" fg="#484f58" />

        <For each={groups()}>
          {(group) => (
            <>
              <text content={'── ' + group.label + ' ──'} fg="#484f58" marginY={0} />
              <For each={group.sessions}>
                {(s) => {
                  //TODO: move selection to a special store, for fast/reactive changes, since now we need to wait
                  // some time for rerender
                  const isSelected = selectedRunId() === s.runId;
                  return (
                    <box
                      flexDirection="column"
                      paddingY={0}
                      paddingX={1}
                      backgroundColor={isSelected && '#1c2128'}
                      onMouseDown={() => selectSession(s)}
                    >
                      <text>
                        {isSelected ? '▶ ' : '  '}{statusIcon(s.status)} {truncate(s.runId, 20)}
                      </text>
                      <text fg="#8b949e" marginBottom={1}>
                        {isSelected ? '   ' : '    '}{s.agent} t{s.tier} · {formatDuration(s)}
                      </text>
                    </box>
                  );
                }}
              </For>
            </>
          )}
        </For>
      </scrollbox>
    </box>
  );
}
