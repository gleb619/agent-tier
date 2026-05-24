import { readFileSync, writeFileSync, mkdirSync, statSync } from 'fs';
import path from 'path';
import { getStateFilePath } from './state-dir';

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

const DEFAULT_MAX_RUNS = 10;
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const STUCK_SILENCE_MS = 30 * 60 * 1000; // 30 min of no log writes

export function getRunsFile(stateDir: string): string {
  return path.join(stateDir, 'runs.jsonl');
}

function getMaxRuns(stateDir: string): number {
  try {
    const statePath = getStateFilePath(stateDir);
    const data = JSON.parse(readFileSync(statePath, 'utf8')) as { runs?: { maxEntries?: number } };
    if (data.runs?.maxEntries !== undefined && Number.isFinite(data.runs.maxEntries)) {
      return Math.max(1, Math.floor(data.runs.maxEntries));
    }
  } catch {
    // ignore missing or malformed state.json
  }
  return DEFAULT_MAX_RUNS;
}

function readJsonl(filePath: string): RunRecord[] {
  try {
    const raw = readFileSync(filePath, 'utf8');
    const lines = raw.split('\n').filter((l) => l.trim().length > 0);
    // Attempt to migrate old plain-JSON format { runs: [...] }
    if (lines.length === 1) {
      try {
        const parsed = JSON.parse(lines[0]) as RunsIndex;
        if (Array.isArray(parsed.runs)) {
          return parsed.runs;
        }
      } catch {
        // not old format, fall through
      }
    }
    return lines.map((l) => JSON.parse(l) as RunRecord);
  } catch {
    return [];
  }
}

function writeJsonl(filePath: string, runs: RunRecord[]): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const lines = runs.map((r) => JSON.stringify(r)).join('\n');
  writeFileSync(filePath, lines ? lines + '\n' : '', 'utf8');
}

export function loadRuns(stateDir: string): RunRecord[] {
  return readJsonl(getRunsFile(stateDir));
}

export function saveRuns(stateDir: string, runs: RunRecord[]): void {
  writeJsonl(getRunsFile(stateDir), runs);
}

export function addRun(stateDir: string, record: RunRecord): void {
  const max = getMaxRuns(stateDir);
  const runs = loadRuns(stateDir);
  runs.push(record);
  // Sort by startedAt descending (newest first)
  runs.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
  const pruned = runs.slice(0, max);
  saveRuns(stateDir, pruned);
}

export function updateRun(stateDir: string, runId: string, updates: Partial<RunRecord>): void {
  const runs = loadRuns(stateDir);
  const run = runs.find((r) => r.runId === runId);
  if (run) {
    Object.assign(run, updates);
    saveRuns(stateDir, runs);
  }
}

export function pruneRuns(
  stateDir: string,
  ttlMs: number = getTtl(),
  maxRuns: number = getMaxRuns(stateDir),
): void {
  const runs = loadRuns(stateDir);
  const cutoff = Date.now() - ttlMs;
  const filtered = runs.filter((r) => {
    const end = r.finishedAt ? new Date(r.finishedAt).getTime() : new Date(r.startedAt).getTime();
    return end >= cutoff;
  });
  // Also enforce max entries cap (keep newest)
  filtered.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
  const pruned = filtered.slice(0, maxRuns);
  if (pruned.length !== runs.length) {
    saveRuns(stateDir, pruned);
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
