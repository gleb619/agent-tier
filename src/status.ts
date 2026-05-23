import { RunRecord, loadRuns, pruneRuns, detectStuck, saveRuns } from './run-store';

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (minutes < 60) return `${minutes}m ${secs}s`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours}h ${mins}m`;
}

function statusIcon(status: RunRecord['status']): string {
  switch (status) {
    case 'running': return 'running';
    case 'done': return 'done';
    case 'failed': return 'failed';
    case 'stuck': return 'stuck';
  }
}

function padRight(s: string, len: number): string {
  return s.length >= len ? s : s + ' '.repeat(len - s.length);
}

export function formatStatusTable(runs: RunRecord[]): string {
  if (runs.length === 0) return '[at] no runs found';

  const now = Date.now();
  const rows = runs.map((r) => {
    const endTime = r.finishedAt ? new Date(r.finishedAt).getTime() : now;
    const duration = formatDuration(endTime - new Date(r.startedAt).getTime());
    return {
      runId: r.runId.slice(0, 6),
      agent: r.agent,
      status: statusIcon(r.status),
      duration,
      log: r.logFile,
    };
  });

  const colRun = Math.max(6, ...rows.map((r) => r.runId.length));
  const colAgent = Math.max(10, ...rows.map((r) => r.agent.length));
  const colStatus = 7;
  const colDur = Math.max(8, ...rows.map((r) => r.duration.length));

  const header =
    padRight('RUN', colRun) + '  ' +
    padRight('AGENT', colAgent) + '  ' +
    padRight('STATUS', colStatus) + '  ' +
    padRight('DURATION', colDur) + '  ' +
    'LOG';

  const lines = rows.map((r) =>
    padRight(r.runId, colRun) + '  ' +
    padRight(r.agent, colAgent) + '  ' +
    padRight(r.status, colStatus) + '  ' +
    padRight(r.duration, colDur) + '  ' +
    r.log,
  );

  return header + '\n' + lines.join('\n');
}

export function runStatus(stateDir: string): void {
  pruneRuns(stateDir);

  let runs = loadRuns(stateDir);
  runs = detectStuck(runs);

  // Persist any stuck/failures detected
  saveRuns(stateDir, runs);

  console.log(formatStatusTable(runs));
}
