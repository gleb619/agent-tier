import { For, Show, createEffect, createMemo } from 'solid-js';
import type { JSX } from 'solid-js';
import { selectedRunId, setSelectedRunId } from '../../tui/store/sessions';
import { filteredSessions2 } from '../store/filtered-sessions';
import {
  activeView,
  focusZone,
  goToView,
  setFocusZone,
  setSidebarFilter,
  setSidebarIndex,
  sidebarFilter,
  sidebarIndex,
  type ActiveView,
} from '../store/ui';
import { formatDuration, statusColor, statusIcon, truncate } from '../format';
import {
  buildRowModel,
  groupRunsByDate as groupRunsByDateImpl,
  moveSelection,
  runLabel as runLabelImpl,
  selectableRowIndices,
  SIDEBAR_MENU_ITEMS,
  type Row,
  type RunGroup,
} from './sidebar/row-model';

/**
 * Public re-exports — older callers (and the row-model test) still import the
 * grouping helpers and the menu item list from this module path.
 */
export interface MenuItem {
  key: string;
  label: string;
  view: ActiveView;
}

export const MENU_ITEMS: MenuItem[] = SIDEBAR_MENU_ITEMS.map(({ key, label, view }) => ({ key, label, view }));

export function groupRunsByDate(runs: Parameters<typeof groupRunsByDateImpl>[0]): RunGroup[] {
  return groupRunsByDateImpl(runs);
}

export function runLabel(run: Parameters<typeof runLabelImpl>[0]): string {
  return runLabelImpl(run);
}

const HINT = '#6e7681';
const DIM = '#8b949e';
const DIMMER = '#484f58';
const SECTION_RULE = '#30363d';
const ACTIVE = '#58a6ff';
const SELECTION = '#1c2128';
const NORMAL = '#c9d1d9';

function rowBox(selected: boolean): {
  flexDirection: 'row' | 'column';
  paddingX: 1;
  backgroundColor: string | undefined;
  marginBottom: number;
} {
  return {
    flexDirection: 'row',
    paddingX: 1,
    backgroundColor: selected ? SELECTION : undefined,
    marginBottom: 1,
  };
}

/** Single, uniform list entry — every row goes through this render path. */
function SidebarRow(props: { row: Row; index: number }): JSX.Element {
  const selected = (): boolean => props.index === sidebarIndex();

  if (props.row.kind === 'separator') {
    // Decorative divider — sits flush against the row above and the row below
    // so the filter input hugs its underline and runs don't pile space onto the
    // closing divider before the next group header.
    return (
      <box paddingX={1} marginBottom={0}>
        <text content="──────────────────────" fg={SECTION_RULE} />
      </box>
    );
  }

  if (props.row.kind === 'group-header') {
    // Full-width row, flexDirection=row + justifyContent=center centers the
    // single text child along the row's main axis so the dashed
    // `── Today ──` label sits exactly in the visual middle of the sidebar
    // column, regardless of column width. No paddingX/left offset, so it
    // can't drift off-center.
    return (
      <box width="100%" flexDirection="row" justifyContent="center" marginBottom={1}>
        <text content={`── ${props.row.label} ──`} fg={DIMMER} />
      </box>
    );
  }

  if (props.row.kind === 'filter') {
    const row = props.row;
    const editing = (): boolean => focusZone() === 'sidebar-filter';
    // The filter row hugs the divider beneath it; spacing below the input
    // is provided by the separator itself, not by an extra marginBottom.
    const filterBox = {
      flexDirection: 'row' as const,
      paddingX: 1,
      backgroundColor: undefined as string | undefined,
      marginBottom: 0,
    };
    const filterBoxSelected = {
      flexDirection: 'row' as const,
      paddingX: 1,
      backgroundColor: SELECTION,
      marginBottom: 0,
    };
    if (editing()) {
      return (
        <box {...filterBoxSelected}>
          <text fg={ACTIVE}>{'/  '}</text>
          <input
            value={sidebarFilter()}
            placeholder="filter runs…"
            focused={true}
            onInput={(v: string) => setSidebarFilter(v)}
            width="100%"
          />
        </box>
      );
    }
    const hintText = (): string => (row.filter ? truncate(row.filter, 12) : '');
    const activate = (): void => {
      setSidebarIndex(props.index);
      setFocusZone('sidebar-filter');
    };
    return (
      <box {...(selected() ? filterBoxSelected : filterBox)} onMouseDown={activate}>
        <text fg={ACTIVE}>{'/  '}</text>
        <text fg={selected() ? NORMAL : DIM}>{'Filter runs…'}</text>
        <text fg={HINT}>{'  '}{hintText()}</text>
      </box>
    );
  }

  if (props.row.kind === 'menu') {
    const row = props.row;
    const activate = (): void => {
      setSidebarIndex(props.index);
      goToView(row.view);
    };
    // Single-line menu row: cursor + `[N]` + label sit in one text node so the
    // hotkey and label read as a single horizontal unit (matches the pre-2-line
    // layout). The `▶` lights when the cursor is on the row OR the menu item
    // represents the active view, so the user always sees which screen is up.
    const isOn = (): boolean => selected() || row.active;
    const marker = (): string => (isOn() ? `▶ [${row.key}]` : `  [${row.key}]`);
    return (
      <box {...rowBox(selected())} onMouseDown={activate}>
        <text fg={isOn() ? ACTIVE : DIM}>{`${marker()} ${row.label}`}</text>
      </box>
    );
  }

  // run
  const row = props.row;
  if (row.kind !== 'run') {
    return <box />;
  }
  const onClick = (): void => {
    setSelectedRunId(row.runId);
    setSidebarIndex(props.index);
    goToView('run-details');
  };
  const statusLine = (): string => {
    const cursor = selected() ? '▶ ' : '  ';
    return `${cursor}${statusIcon(row.run.status)} ${truncate(runLabel(row.run), 18)}`;
  };
  const subLabel = (): string => {
    const indent = selected() ? '   ' : '    ';
    return `${indent}${row.run.agent} t${row.run.tier} · ${formatDuration(row.run)}`;
  };
  return (
    <box
      {...rowBox(selected())}
      flexDirection="column"
      onMouseDown={onClick}
    >
      <text fg={statusColor(row.run.status)}>{statusLine()}</text>
      <text fg={row.runId === selectedRunId() ? NORMAL : HINT}>{subLabel()}</text>
    </box>
  );
}

export function Sidebar(): JSX.Element {
  const groups = createMemo(() => groupRunsByDate(filteredSessions2()));
  const rows = createMemo(() =>
    buildRowModel({
      groups: groups(),
      filter: sidebarFilter(),
      activeView: activeView(),
    }),
  );
  const selectable = createMemo(() => selectableRowIndices(rows()));

  // Whenever the row list shrinks (runs filtered out), snap the cursor back
  // onto the first selectable row instead of leaving it on a now-vanished row.
  createEffect(() => {
    const sel = selectable();
    const idx = sidebarIndex();
    if (sel.length === 0) {
      if (idx !== -1) setSidebarIndex(-1);
      return;
    }
    if (idx < 0 || !sel.includes(idx)) {
      setSidebarIndex(sel[0]);
    }
  });

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
      <scrollbox flexGrow={1} onMouseDown={() => setFocusZone('sidebar-list')}>
        <For each={rows()}>
          {(row, i) => <SidebarRow row={row} index={i()} />}
        </For>
        <Show when={groups().length === 0}>
          <box paddingX={1}>
            <text fg={DIMMER} content="(no runs match)" />
          </box>
        </Show>
      </scrollbox>
    </box>
  );
}

/** Pure helper for the keyboard handler in App.tsx. */
export function nextSidebarIndex(delta: 1 | -1): number {
  return moveSelection(
    buildRowModel({
      groups: groupRunsByDate(filteredSessions2()),
      filter: sidebarFilter(),
      activeView: activeView(),
    }),
    sidebarIndex(),
    delta,
  );
}
