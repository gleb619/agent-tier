import { createSignal, createMemo, Accessor } from 'solid-js';
import { spawn } from 'child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { RunRecord } from '../../run-store';
import { refreshRuns } from '../../run-store';
import { joinRuns } from '../../status';
import { resolveStatusDirs, getStateFilePath } from '../../state-dir';

// Same joined scope as `at status`: project `.at/` first, then `~/.at/`.
// The TUI used to resolve a single dir, so global runs stayed invisible
// whenever the project had its own `.at/` — `at status` showed them, the
// TUI did not.
const stateDirs = resolveStatusDirs();
// Primary dir for TUI-local prefs (selectedRunId) — the old single-dir choice.
const stateDir = stateDirs[0];

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

/**
 * Field-by-field equality of a run record. Deliberately explicit rather than
 * `JSON.stringify` comparison: the run store rebuilds running entries as new
 * objects on every refresh, and key order is not a meaningful difference.
 */
function runEqual(a: RunRecord, b: RunRecord): boolean {
  return (
    a.runId === b.runId &&
    a.agent === b.agent &&
    a.tier === b.tier &&
    a.pid === b.pid &&
    a.prompt === b.prompt &&
    a.logFile === b.logFile &&
    a.startedAt === b.startedAt &&
    a.finishedAt === b.finishedAt &&
    a.exitCode === b.exitCode &&
    a.status === b.status &&
    a.name === b.name
  );
}

/**
 * Do two run snapshots carry the same data in the same order?
 *
 * `refreshRuns` hands back freshly parsed objects every poll, so identity is
 * never stable — this is what lets the TUIs skip signal writes (and the
 * re-render/flicker that follows) when nothing actually changed.
 */
export function runsEqual(a: RunRecord[], b: RunRecord[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (!runEqual(a[i], b[i])) return false;
  }
  return true;
}

export function refreshSessions(): Promise<void> {
  // Atomic prune+detect under the runs-file lock; the old fire-and-forget
  // pruneRuns() + loadRuns() pair rendered a snapshot from before the prune.
  // Every resolved dir is refreshed, then merged like `at status` does —
  // the promise is returned so callers (and tests) can await the merged
  // snapshot instead of racing a void fire-and-forget.
  return Promise.all(stateDirs.map((dir) => refreshRuns(dir)))
    .then((runsPerDir) => {
      const updated = joinRuns(stateDirs, runsPerDir);
      // Only publish when the snapshot actually moved: the poll re-reads
      // runs.jsonl every few seconds, and pushing an identical array would
      // invalidate every downstream memo (sidebar rows, dashboard counters)
      // and re-render the list for nothing.
      if (!runsEqual(sessions(), updated)) {
        setSessions(updated);
      }

      const currentId = selectedRunId();
      if (!currentId || !updated.find((s) => s.runId === currentId)) {
        const next = updated.length > 0 ? updated[0].runId : null;
        if (next !== currentId) setSelectedRunId(next);
      }
    })
    .catch(() => {
      // Lock contention or a transient read error: keep the last good snapshot
      // and let the next poll try again.
    });
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
