import { For, createMemo } from 'solid-js';
import type { JSX } from 'solid-js';
import {
  filteredSessions,
  selectedRunId,
  setSelectedRunId,
  sidebarFilter,
  setSidebarFilter,
  showDashboard,
  setShowDashboard,
} from '../store/sessions';

import type { RunRecord } from '../../run-store';

interface SidebarProps {
  focused: boolean;
  focusZone: 0 | 1;
}

export function statusIcon(status: RunRecord['status']): string {
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

export function statusColor(status: RunRecord['status']): string {
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

export function formatDuration(r: RunRecord): string {
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

export function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 1) + '…';
}

function selectSession(s: RunRecord): void {
  if (showDashboard()) {
    setShowDashboard(false);
  }
  setSelectedRunId(s.runId);
}

export type SidebarItem =
  | { type: 'session'; data: RunRecord; isSelected: boolean }
  | { type: 'action'; label: string; icon: string; active: boolean; onSelect: () => void };

export interface SidebarGroup {
  label: string;
  items: SidebarItem[];
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

export function groupSessionsByDate(sessions: RunRecord[], selectedId: string | null): SidebarGroup[] {
  const groups: SidebarGroup[] = [];
  let currentLabel: string | null = null;
  let currentGroup: SidebarGroup | null = null;

  for (let i = 0; i < sessions.length; i++) {
    const session = sessions[i];
    const label = getDateBucket(session.startedAt);
    const item: SidebarItem = {
      type: 'session',
      data: session,
      isSelected: session.runId === selectedId,
    };
    if (label !== currentLabel) {
      if (currentGroup) {
        groups.push(currentGroup);
      }
      currentLabel = label;
      currentGroup = { label, items: [item] };
    } else if (currentGroup) {
      currentGroup.items.push(item);
    }
  }

  if (currentGroup) {
    groups.push(currentGroup);
  }

  return groups;
}

export function buildSidebarGroups(
  sessions: RunRecord[],
  selectedId: string | null,
  dashboardActive: boolean,
  onSelectDashboard: () => void
): SidebarGroup[] {
  const sessionGroups = groupSessionsByDate(sessions, selectedId);
  const actionGroup: SidebarGroup = {
    label: 'Actions',
    items: [
      {
        type: 'action',
        label: 'Dashboard',
        icon: '📊',
        active: dashboardActive,
        onSelect: onSelectDashboard,
      },
    ],
  };
  return [actionGroup, ...sessionGroups];
}

export function Sidebar(props: SidebarProps): JSX.Element {
  const groups = createMemo(() =>
    buildSidebarGroups(
      filteredSessions(),
      selectedRunId(),
      showDashboard(),
      () => {
        setShowDashboard(true);
        setSelectedRunId(null);
      }
    )
  );

  return (
    <box
      title="Sessions"
      border
      borderStyle="single"
      borderColor={props.focused ? (props.focusZone === 1 ? '#00ddff' : '#00aaff') : '#555555'}
      focused={props.focused}
      flexDirection="column"
      flexGrow={1}
      padding={1}
    >
      <input
        value={sidebarFilter()}
        placeholder={props.focusZone === 0 ? '🔍 Filter runs...' : 'Filter runs...'}
        focused={props.focusZone === 0}
        onInput={(v: string) => setSidebarFilter(v)}
        width="100%"
      />

      <text content="───────────────────────────" fg={props.focusZone === 0 ? '#00aaff' : '#555555'} />

      <scrollbox flexGrow={1}>
        <For each={groups()}>
          {(group) => (
            <>
              <box
                width="100%"
                justifyContent="center"
                alignItems="center"
                paddingBottom={1}>
                <text content={'── ' + group.label + ' ──'} fg="#484f58" marginY={0} />
              </box>
              <For each={group.items}>
                {(item) => {
                  if (item.type === 'action') {
                    return (
                      <box
                        flexDirection="column"
                        paddingY={0}
                        paddingX={1}
                        backgroundColor={item.active ? '#1c2128' : undefined}
                        onMouseDown={() => item.onSelect()}
                      >
                        <text fg="#58a6ff" paddingY={1}>
                          {item.active ? '▶ ' : '  '}{item.icon} {item.label}
                        </text>
                      </box>
                    );
                  }
                  return (
                    <box
                      flexDirection="column"
                      paddingY={0}
                      paddingX={1}
                      backgroundColor={item.isSelected ? '#1c2128' : undefined}
                      onMouseDown={() => selectSession(item.data)}
                    >
                      <text>
                        {item.isSelected ? '▶ ' : '  '}{statusIcon(item.data.status)} {truncate(item.data.runId, 20)}
                      </text>
                      <text fg="#8b949e" marginBottom={1}>
                        {item.isSelected ? '   ' : '    '}{item.data.agent} t{item.data.tier} · {formatDuration(item.data)}
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
