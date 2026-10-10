import { For, Show, createMemo } from 'solid-js';
import type { JSX } from 'solid-js';
import { UNNAMED_PLACEHOLDER, type RunRecord } from '../../run-store';
import { selectedRunId, setSelectedRunId } from '../../tui/store/sessions';
import { filteredSessions2 } from '../store/filtered-sessions';
import {
  activeView,
  focusZone,
  goToView,
  setFocusZone,
  sidebarFilter,
  setSidebarFilter,
  type ActiveView,
} from '../store/ui';
import { dateBucket, formatDuration, statusColor, statusIcon, truncate } from '../format';

export interface MenuItem {
  key: string;
  label: string;
  view: ActiveView;
}

/** Numeric hotkeys per design doc §11.6 (3 = Run Details, 4 = Settings). */
export const MENU_ITEMS: MenuItem[] = [
  { key: '1', label: 'Dashboard', view: 'dashboard' },
  { key: '2', label: 'New Task', view: 'new-task' },
  { key: '3', label: 'Run Details', view: 'run-details' },
  { key: '4', label: 'Settings', view: 'settings' },
];

export interface RunGroup {
  label: string;
  runs: RunRecord[];
}

/** Bucket an already-ordered run list by day, keeping the input order. */
export function groupRunsByDate(runs: RunRecord[]): RunGroup[] {
  const groups: RunGroup[] = [];
  for (const run of runs) {
    const label = dateBucket(run.startedAt);
    const last = groups[groups.length - 1];
    if (last && last.label === label) {
      last.runs.push(run);
    } else {
      groups.push({ label, runs: [run] });
    }
  }
  return groups;
}

/** Namer output when it resolved, otherwise the run id. */
export function runLabel(run: RunRecord): string {
  return run.name === UNNAMED_PLACEHOLDER ? run.runId : run.name;
}

export function Sidebar(): JSX.Element {
  const groups = createMemo(() => groupRunsByDate(filteredSessions2()));

  function openRun(run: RunRecord): void {
    setSelectedRunId(run.runId);
    goToView('run-details');
  }

  return (
    <box
      title="at — tui2"
      border
      borderStyle="single"
      borderColor={focusZone().startsWith('sidebar') ? '#00aaff' : '#555555'}
      flexDirection="column"
      flexGrow={1}
      padding={1}
    >
      <For each={MENU_ITEMS}>
        {(item) => (
          <box
            flexDirection="row"
            paddingX={1}
            backgroundColor={activeView() === item.view ? '#1c2128' : undefined}
            onMouseDown={() => goToView(item.view)}
          >
            <text fg={activeView() === item.view ? '#58a6ff' : '#8b949e'}>
              {activeView() === item.view ? '▶ ' : '  '}[{item.key}] {item.label}
            </text>
          </box>
        )}
      </For>

      <text content="──────────────────────" fg="#30363d" />

      <input
        value={sidebarFilter()}
        placeholder={focusZone() === 'sidebar-filter' ? '🔍 id / agent / prompt…' : '🔍 Filter runs…'}
        focused={focusZone() === 'sidebar-filter'}
        onInput={(v: string) => setSidebarFilter(v)}
        width="100%"
      />

      <text content="──────────────────────" fg="#30363d" />

      <scrollbox flexGrow={1} onMouseDown={() => setFocusZone('sidebar-list')}>
        <Show
          when={groups().length > 0}
          fallback={<text fg="#484f58" content="  (no runs match)" />}
        >
          <For each={groups()}>
            {(group) => (
              <>
                <box width="100%" justifyContent="center">
                  <text content={`── ${group.label} ──`} fg="#484f58" />
                </box>
                <For each={group.runs}>
                  {(run) => {
                    const selected = run.runId === selectedRunId();
                    return (
                      <box
                        flexDirection="column"
                        paddingX={1}
                        backgroundColor={selected ? '#1c2128' : undefined}
                        onMouseDown={() => openRun(run)}
                      >
                        <text fg={statusColor(run.status)}>
                          {selected ? '▶ ' : '  '}{statusIcon(run.status)} {truncate(runLabel(run), 22)}
                        </text>
                        <text fg="#8b949e" marginBottom={1}>
                          {selected ? '   ' : '    '}{run.agent} t{run.tier} · {formatDuration(run)}
                        </text>
                      </box>
                    );
                  }}
                </For>
              </>
            )}
          </For>
        </Show>
      </scrollbox>
    </box>
  );
}
