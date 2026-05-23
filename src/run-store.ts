import { readFileSync, writeFileSync, mkdirSync, statSync } from 'fs';
import path from 'path';

export interface RunRecord {
  runId: string;
  agent: string;
  tier: number;
  pid: number;
  prompt: string;
  logFile: string;
  startedAt: string;
  finishedAt: string | null;
  exitCode: number | null;
  status: 'running' | 'done' | 'failed' | 'stuck';
}

export interface RunsIndex {
  runs: RunRecord[];
}

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const STUCK_SILENCE_MS = 30 * 60 * 1000; // 30 min of no log writes

export function getRunsFile(stateDir: string): string {
  return path.join(stateDir, 'runs.json');
}

export function loadRuns(stateDir: string): RunsIndex {
  try {
    const data = readFileSync(getRunsFile(stateDir), 'utf8');
    return JSON.parse(data) as RunsIndex;
  } catch {
    return { runs: [] };
  }
}

export function saveRuns(stateDir: string, index: RunsIndex): void {
  const runsFile = getRunsFile(stateDir);
  mkdirSync(path.dirname(runsFile), { recursive: true });
  writeFileSync(runsFile, JSON.stringify(index, null, 2), 'utf8');
}

export function addRun(stateDir: string, record: RunRecord): void {
  const index = loadRuns(stateDir);
  index.runs.push(record);
  saveRuns(stateDir, index);
}

export function updateRun(stateDir: string, runId: string, updates: Partial<RunRecord>): void {
  const index = loadRuns(stateDir);
  const run = index.runs.find((r) => r.runId === runId);
  if (run) {
    Object.assign(run, updates);
    saveRuns(stateDir, index);
  }
}

export function pruneRuns(stateDir: string, ttlMs: number = getTtl()): void {
  const index = loadRuns(stateDir);
  const cutoff = Date.now() - ttlMs;
  const pruned = index.runs.filter((r) => {
    const end = r.finishedAt ? new Date(r.finishedAt).getTime() : new Date(r.startedAt).getTime();
    return end >= cutoff;
  });
  if (pruned.length !== index.runs.length) {
    saveRuns(stateDir, { runs: pruned });
  }
}

export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function getLogMtime(logFile: string): number | null {
  try {
    return statSync(logFile).mtimeMs;
  } catch {
    return null;
  }
}

export function detectStuck(runs: RunRecord[]): RunRecord[] {
  const now = Date.now();
  return runs.map((r) => {
    if (r.status !== 'running') return r;

    const pidAlive = isPidAlive(r.pid);
    const logMtime = getLogMtime(r.logFile);
    const logSilence = logMtime ? now - logMtime : now - new Date(r.startedAt).getTime();

    if (!pidAlive) {
      return { ...r, status: 'failed' as const, finishedAt: new Date().toISOString(), exitCode: null };
    }

    if (logSilence > STUCK_SILENCE_MS) {
      return { ...r, status: 'stuck' as const };
    }

    return r;
  });
}

function getTtl(): number {
  const env = process.env.AT_STATUS_TTL_MS;
  return env ? Number(env) : DEFAULT_TTL_MS;
}
