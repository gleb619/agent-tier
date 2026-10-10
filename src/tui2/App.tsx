import { For, createEffect, createMemo, onCleanup, onMount } from 'solid-js';
import type { JSX } from 'solid-js';
import { useKeyboard, useRenderer } from '@opentui/solid';
import type { KeyEvent } from '@opentui/core';
import {
  killSession,
  loadSessionState,
  refreshSessions,
  retrySession,
  selectedRunId,
  selectedSession,
  setSelectedRunId,
} from '../tui/store/sessions';
import {
  autoRefresh,
  goToHead,
  goToTail,
  loadLogFile,
  logLines,
  refreshLog,
  scrollOffset,
  setCurrentLogFile,
  setAutoRefresh,
  setLogLines,
  setScrollOffset,
  VISIBLE_LINES,
} from '../tui/store/log';
import { agent, cycleAgent, cycleMode, cycleRetries, cycleTier, loadSettings, mode, tier } from '../tui/store/settings';
import { filteredSessions2 } from './store/filtered-sessions';
import {
  activeView,
  cycleZone,
  focusZone,
  goToView,
  isTextEntryFocused,
  mainZoneForView,
  setFocusZone,
  settingsRow,
  setSettingsRow,
  setShowPromptOverlay,
  type ActiveView,
} from './store/ui';
import { Sidebar } from './components/Sidebar';
import { MainView } from './components/MainView';
import { SETTING_ACTIONS, clampRow } from './components/Settings';
import { formatClock, truncate } from './format';

const AUTO_REFRESH_MS = 5000;

const VIEW_LABELS: Record<ActiveView, string> = {
  dashboard: 'dashboard',
  'new-task': 'new task',
  'run-details': 'run details',
  settings: 'settings',
};

export function App(): JSX.Element {
  const renderer = useRenderer();
  let refreshTimer: ReturnType<typeof setInterval> | null = null;

  function stopAutoRefresh(): void {
    if (refreshTimer === null) return;
    clearInterval(refreshTimer);
    refreshTimer = null;
  }

  // Must mirror Ctrl+C's built-in path: destroy(), not stop(). stop() leaves raw mode
  // and the ref'd interval in place, so the CLI process never returns to the shell.
  function quit(): void {
    stopAutoRefresh();
    renderer.destroy();
  }

  createEffect(() => {
    if (autoRefresh()) {
      stopAutoRefresh();
      refreshTimer = setInterval(() => {
        refreshSessions();
        refreshLog();
      }, AUTO_REFRESH_MS);
    } else {
      stopAutoRefresh();
    }
  });

  onCleanup(stopAutoRefresh);

  // The log store always follows the selected run, whatever view is on screen.
  createEffect(() => {
    const session = selectedSession();
    if (session) {
      setCurrentLogFile(session.logFile);
      loadLogFile(session.logFile);
    } else {
      setCurrentLogFile(null);
      setLogLines([]);
    }
  });

  onMount(() => {
    loadSessionState();
    loadSettings();
    refreshSessions();
  });

  function moveRunSelection(delta: 1 | -1): void {
    const runs = filteredSessions2();
    if (runs.length === 0) return;
    const idx = runs.findIndex((r) => r.runId === selectedRunId());
    if (idx === -1) {
      setSelectedRunId(runs[0].runId);
      return;
    }
    const next = Math.max(0, Math.min(runs.length - 1, idx + delta));
    setSelectedRunId(runs[next].runId);
  }

  function scrollLog(delta: 1 | -1): void {
    const max = Math.max(0, logLines().length - 1);
    setScrollOffset(Math.max(0, Math.min(max, scrollOffset() + delta)));
  }

  function togglePrompt(): void {
    setShowPromptOverlay((v) => !v);
  }

  function retrySelected(): void {
    const id = selectedRunId();
    if (id) retrySession(id);
  }

  function applySettingsRow(): void {
    SETTING_ACTIONS[clampRow(settingsRow())].act();
  }

  // Jump between the head and the tail of the log (classic TUI behaviour).
  function jumpLog(): void {
    if (scrollOffset() === 0) goToTail();
    else goToHead();
  }

  useKeyboard((key: KeyEvent) => {
    if (key.eventType !== 'press') return;

    const { name, ctrl, shift } = key;
    const view = activeView();

    if (ctrl) {
      switch (name) {
        case 'q':
          quit();
          return;
        case 'r':
          refreshSessions();
          refreshLog();
          return;
        case 't':
          cycleTier();
          return;
        case 'a':
          cycleAgent();
          return;
        case 'o':
          cycleMode();
          return;
        case 'n':
          cycleRetries();
          return;
        case 'k': {
          const id = selectedRunId();
          if (id) killSession(id);
          return;
        }
        case 'p':
          if (view === 'run-details') togglePrompt();
          return;
        case 'd':
          if (view === 'run-details') jumpLog();
          return;
      }
      return;
    }

    if (name === 'escape') {
      // Esc only leaves a text field; the focused renderable swallows the first ESC,
      // so it is deliberately not a quit binding (Ctrl+Q / q are).
      if (isTextEntryFocused()) setFocusZone('sidebar-list');
      return;
    }

    if (name === 'tab') {
      cycleZone(shift ? -1 : 1);
      return;
    }

    // Plain-character hotkeys are swallowed by text fields.
    if (isTextEntryFocused()) return;

    const zone = focusZone();

    if (name === '1') goToView('dashboard');
    else if (name === '2') goToView('new-task');
    else if (name === '3') goToView('run-details');
    else if (name === '4') goToView('settings');
    else if (name === 'q') quit();
    else if (zone === 'settings') {
      if (name === 'up' || name === 'k') setSettingsRow(clampRow(settingsRow() - 1));
      else if (name === 'down' || name === 'j') setSettingsRow(clampRow(settingsRow() + 1));
      else if (name === 'return') applySettingsRow();
    } else if (zone === 'log') {
      // Doc §11.1 wants j/k to switch runs while §11.4 wants them to scroll the log;
      // scroll stays lowercase, run switching moves to Shift+J/K.
      if ((shift && name === 'j') || name === 'J') moveRunSelection(1);
      else if ((shift && name === 'k') || name === 'K') moveRunSelection(-1);
      else if (name === 'down' || name === 'j') scrollLog(1);
      else if (name === 'up' || name === 'k') scrollLog(-1);
      else if (name === 'p') togglePrompt();
      else if (name === 'r') retrySelected();
    } else if (zone === 'sidebar-list') {
      if (name === 'down' || name === 'j') moveRunSelection(1);
      else if (name === 'up' || name === 'k') moveRunSelection(-1);
      else if (name === 'return' && selectedRunId()) goToView('run-details');
      else if (name === 'r' && view === 'run-details') retrySelected();
      else if (name === 'p' && view === 'run-details') togglePrompt();
    }
  });

  const headerFields = createMemo((): string[] => {
    const view = activeView();
    const fields = ['at — agent tier', `auto-refresh ${autoRefresh() ? 'ON' : 'OFF'}`];

    if (view === 'run-details') {
      const total = logLines().length;
      const session = selectedSession();
      fields.push(
        `view: ${view}`,
        `dir: ${scrollOffset() === 0 ? 'head' : scrollOffset() >= total - VISIBLE_LINES ? 'tail' : 'scroll'}`,
        `lines: ${Math.min(VISIBLE_LINES, Math.max(0, total - scrollOffset()))}/${total}`,
      );
      if (session) {
        fields.push(
          `status: ${session.status}`,
          `code: ${session.exitCode ?? '-'}`,
          `started: ${formatClock(session.startedAt)}`,
          `finished: ${formatClock(session.finishedAt)}`,
          `pid: ${session.pid}`,
          `agent: ${session.agent}`,
          `tier: ${session.tier}`,
        );
      }
      return fields;
    }

    const runs = filteredSessions2();
    if (view === 'dashboard') {
      const running = runs.filter((r) => r.status === 'running').length;
      fields.push(`view: ${view}`, `total: ${runs.length}`, `active: ${running}`, `finished: ${runs.length - running}`);
    } else if (view === 'new-task') {
      fields.push(`view: ${view}`, `tier: ${tier()}`, `agent: ${agent()}`, `mode: ${mode()}`);
    } else {
      fields.push(`view: ${view}`, `runs: ${runs.length}`);
    }
    return fields;
  });

  const footerLine = createMemo((): string => {
    const view = activeView();
    const common = '[1-4] views  [Tab] focus  [^R] refresh  [^Q] quit';

    if (view === 'new-task') {
      return focusZone() === 'prompt'
        ? '[Enter] submit  [Shift+Enter] newline  [^T] tier  [^A] agent  [^O] mode  [^N] retries  [Esc] leave field'
        : `[Tab] edit prompt  ${common}`;
    }
    if (view === 'settings') {
      return `[↑/↓] select  [Enter] change  ${common}`;
    }
    if (view === 'run-details') {
      const nav = focusZone() === 'log' ? '[j/k] scroll  [J/K] run  [^D] head/tail' : '[j/k] prev/next run  [Enter] details';
      return `${nav}  [p] prompt  [r] retry  [^K] kill  ${common}`;
    }
    return `[j/k] runs  [Enter] open run  ${common}`;
  });

  return (
    <box width="100%" height="100%" flexDirection="column">
      <box flexDirection="row" gap={2} paddingX={1}>
        <For each={headerFields()}>
          {(field, i) => (
            <text
              content={truncate(field, 60)}
              fg={i() === 0 ? '#58a6ff' : i() === 1 ? (autoRefresh() ? '#3fb950' : '#555555') : '#aaaaaa'}
            />
          )}
        </For>
      </box>

      <box flexDirection="row" flexGrow={1}>
        <box width="28%" flexDirection="column" onMouseDown={() => setFocusZone('sidebar-list')}>
          <Sidebar />
        </box>
        <box
          flexGrow={1}
          flexDirection="column"
          onMouseDown={() => setFocusZone(mainZoneForView(activeView()))}
        >
          <MainView />
        </box>
      </box>

      <box flexDirection="row" paddingX={1}>
        <text content={footerLine()} fg="#484f58" />
      </box>
    </box>
  );
}
