import { createSignal, createMemo, Accessor } from 'solid-js';
import { spawn } from 'child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { RunRecord } from '../../run-store';
import { loadRuns, pruneRuns, detectStuck } from '../../run-store';
import { resolveStateDir, getStateFilePath } from '../../state-dir';

const stateDir = resolveStateDir();

const [sessions, setSessions] = createSignal<RunRecord[]>([]);
const [selectedRunId, setSelectedRunId] = createSignal<string | null>(null);
const [sidebarFilter, setSidebarFilter] = createSignal<string>('');
const [showDashboard, setShowDashboard] = createSignal(false);

export { showDashboard, setShowDashboard };

export function toggleDashboard(): void {
  setShowDashboard(!showDashboard());
}

export const selectedSession: Accessor<RunRecord | null> = createMemo(() => {
  const id = selectedRunId();
  if (!id) return null;
  return sessions().find((s) => s.runId === id) ?? null;
});

export { sessions, setSessions, selectedRunId, setSelectedRunId, sidebarFilter, setSidebarFilter };

export const filteredSessions: Accessor<RunRecord[]> = createMemo(() => {
  const filter = sidebarFilter().toLowerCase();
  if (!filter) return sessions();
  return sessions().filter(
    (s) =>
      s.runId.toLowerCase().includes(filter) ||
      s.agent.toLowerCase().includes(filter) ||
      s.status.toLowerCase().includes(filter)
  );
});

export function refreshSessions(): void {
  pruneRuns(stateDir);
  const runs = loadRuns(stateDir);
  const updated = detectStuck(runs);
  setSessions(updated);

  const currentId = selectedRunId();
  if (!currentId || !updated.find((s) => s.runId === currentId)) {
    if (updated.length > 0) {
      setSelectedRunId(updated[0].runId);
    } else {
      setSelectedRunId(null);
    }
  }
}

export function killSession(runId: string): void {
  const session = sessions().find((s) => s.runId === runId);
  if (!session) return;
  try {
    process.kill(session.pid, 'SIGKILL');
  } catch {
    // silent
  }
  refreshSessions();
}

export function retrySession(runId: string): void {
  const session = sessions().find((s) => s.runId === runId);
  if (!session) return;
  spawn('at', ['-s', '-p', session.prompt], {
    detached: false,
    stdio: 'inherit',
  });
  refreshSessions();
}

export function loadSessionState(): void {
  try {
    const path = getStateFilePath(stateDir);
    const data = JSON.parse(readFileSync(path, 'utf8')) as { tui?: { selectedRunId?: string | null } };
    if (data.tui && 'selectedRunId' in data.tui) {
      setSelectedRunId(data.tui.selectedRunId ?? null);
    }
  } catch {
    // ignore missing or malformed state.json
  }
}

export function saveSessionState(runId: string | null): void {
  try {
    const path = getStateFilePath(stateDir);
    let data: Record<string, unknown> = {};
    try {
      data = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    } catch {
      // ignore missing or malformed state.json
    }
    const tui = (data.tui as Record<string, unknown> | undefined) ?? {};
    tui.selectedRunId = runId;
    data.tui = tui;
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(path, JSON.stringify(data, null, 2), 'utf8');
  } catch {
    // ignore write errors
  }
}
