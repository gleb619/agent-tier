import { RunRecord, loadRuns, pruneRuns, detectStuck, saveRuns } from './run-store';
import { loadStateFile } from './scheduler';
import { getStateFilePath } from './state-dir';
import { AGENTS, getAgentsByTier } from './agents/registry';
import { loadHealth, AgentHealth } from './health';

// --- Data types ---

export interface StatusReport {
  total: number;
  runs: RunRecord[];
}

export interface SchedulerEntry {
  key: string;
  index: number;
  agentName: string | undefined;
}

export interface AgentHealthEntry {
  name: string;
  deactivated: boolean;
  failures: number;
  lastFailure: string | undefined;
  disabledTo: string | undefined;
}

export interface StateReport {
  scheduler: SchedulerEntry[];
  maxEntries: number | undefined;
  agents: AgentHealthEntry[];
}

// --- Data layer: build structured reports ---

export function buildStatusReport(runs: RunRecord[]): StatusReport {
  return { total: runs.length, runs };
}

export function buildStateReport(stateDir: string): StateReport {
  const stateFilePath = getStateFilePath(stateDir);
  const state = loadStateFile(stateFilePath);
  const scheduler: SchedulerEntry[] = [];

  if (state.scheduler && Object.keys(state.scheduler).length > 0) {
    for (const [key, sched] of Object.entries(state.scheduler)) {
      let agentName: string | undefined;
      const tierMatch = key.match(/^tier-([1-4])$/) || key.match(/^([1-4])$/);
      if (tierMatch) {
        const tier = Number(tierMatch[1]) as 1 | 2 | 3 | 4;
        agentName = getAgentsByTier(tier)[sched.index]?.name;
      } else {
        agentName = AGENTS[sched.index]?.name;
      }
      scheduler.push({ key, index: sched.index, agentName });
    }
  }

  const health = loadHealth(stateFilePath);
  const agents: AgentHealthEntry[] = Object.entries(health.agents).map(
    ([name, h]) => buildAgentHealthEntry(name, h),
  );

  return { scheduler, maxEntries: state.runs?.maxEntries, agents };
}

function formatIsoRelative(iso: string): string {
  const d = new Date(iso);
  const now = Date.now();
  const diffMs = d.getTime() - now;
  const absDiff = Math.abs(diffMs);

  const relative = absDiff < 60_000
    ? 'just now'
    : absDiff < 3_600_000
      ? `${Math.floor(absDiff / 60_000)}m ${diffMs < 0 ? 'ago' : 'from now'}`
      : absDiff < 86_400_000
        ? `${Math.floor(absDiff / 3_600_000)}h ${diffMs < 0 ? 'ago' : 'from now'}`
        : `${Math.floor(absDiff / 86_400_000)}d ${diffMs < 0 ? 'ago' : 'from now'}`;

  const time = d.toLocaleString();
  return `${relative} (${time})`;
}

function buildAgentHealthEntry(name: string, h: AgentHealth): AgentHealthEntry {
  const sorted = [...h.failureTimes].sort();
  const lastFailure = sorted.length > 0 ? sorted[sorted.length - 1] : undefined;
  return {
    name,
    deactivated: h.deactivated === true,
    failures: h.failureTimes.length,
    lastFailure,
    disabledTo: h.disabledTo ?? undefined,
  };
}

// --- Formatting: text table from data ---

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
    const truncate = (str: string): string => str.length > 20 ? str.slice(0, 17) + '...' : str;

    return {
      runId: truncate(r.runId),
      agent: r.agent,
      status: statusIcon(r.status),
      duration,
      log: r.logFile,
    };
  });

  const colRun = Math.max(20, ...rows.map((r) => r.runId.length));
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

export function formatStatusJson(runs: RunRecord[]): string {
  return JSON.stringify(buildStatusReport(runs));
}

export function formatStateReport(stateDir: string): string {
  const report = buildStateReport(stateDir);
  const lines: string[] = [];

  lines.push('┌─ State ──────────────────────┐');
  lines.push('Scheduler:');

  if (report.scheduler.length > 0) {
    for (const entry of report.scheduler) {
      if (entry.agentName) {
        lines.push(`  ${entry.key} → index ${entry.index} (${entry.agentName})`);
      } else {
        lines.push(`  ${entry.key} → index ${entry.index}`);
      }
    }
  } else {
    lines.push('  (none)');
  }

  lines.push('Config:');
  if (report.maxEntries !== undefined) {
    lines.push(`  max runs: ${report.maxEntries}`);
  } else {
    lines.push('  (none)');
  }

  if (report.agents.length > 0) {
    lines.push('Agents:');
    for (const a of report.agents) {
      const flags: string[] = [];
      if (a.deactivated) flags.push('DEACTIVATED');
      if (a.failures > 0) flags.push(`${a.failures} failures`);
      if (a.disabledTo) flags.push(`disabled until ${formatIsoRelative(a.disabledTo)}`);
      if (a.lastFailure) flags.push(`last: ${formatIsoRelative(a.lastFailure)}`);
      lines.push(flags.length > 0 ? `  ${a.name}: ${flags.join(', ')}` : `  ${a.name}: ok`);
    }
  }

  lines.push('───────────────────────────────');

  return lines.join('\n');
}

export function formatCombinedReport(stateDir: string, runs: RunRecord[]): string {
  return formatStatusTable(runs) + '\n\n' + formatStateReport(stateDir);
}

export function runStatus(stateDir: string, opts?: { json?: boolean }): void {
  pruneRuns(stateDir);

  let runs = loadRuns(stateDir);
  runs = detectStuck(runs);

  saveRuns(stateDir, runs);

  if (opts?.json) {
    process.stdout.write(formatStatusJson(runs) + '\n');
    return;
  }

  console.log(formatCombinedReport(stateDir, runs));
}
