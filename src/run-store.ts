import { readFileSync, writeFileSync, mkdirSync, statSync } from 'fs';
import path from 'path';
import { getStateFilePath } from './state-dir';
import { withLock } from './lock';
import { isPidAlive, getProcessTicks } from './process-utils';

/** Placeholder `RunRecord.name` until the namer resolves — or forever, when it never does. */
export const UNNAMED_PLACEHOLDER = 'unnamed';

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
  /**
   * Human-readable session name produced by the namer (`src/namer`). Starts as
   * `UNNAMED_PLACEHOLDER` and is overwritten asynchronously once a provider
   * answers; stays at the placeholder when every provider fails, so consumers
   * (`at status`, TUI sidebar) can always render a stable column.
   */
  name: string;
}

export interface RunsIndex {
  runs: RunRecord[];
}

const DEFAULT_MAX_RUNS = 30;
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const STUCK_SILENCE_MS = 30 * 60 * 1000; // 30 min of no log writes
const STUCK_CPU_MS_THRESHOLD = 100; // any measurable work — jiffy granularity is 10ms

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

export async function addRun(stateDir: string, record: RunRecord): Promise<void> {
  const runsFile = getRunsFile(stateDir);
  return withLock(runsFile, () => {
    const max = getMaxRuns(stateDir);
    const runs = readJsonl(runsFile);
    runs.unshift(record);
    const pruned = runs.slice(0, max);
    writeJsonl(runsFile, pruned);
  });
}

export async function updateRun(stateDir: string, runId: string, updates: Partial<RunRecord>): Promise<void> {
  const runsFile = getRunsFile(stateDir);
  return withLock(runsFile, () => {
    const runs = readJsonl(runsFile);
    const run = runs.find((r) => r.runId === runId);
    if (run) {
      Object.assign(run, updates);
      writeJsonl(runsFile, runs);
    }
  });
}

/** TTL/max cutoff filter + newest-first ordering. Pure: no I/O. */
function pruneList(runs: RunRecord[], ttlMs: number, maxRuns: number): RunRecord[] {
  const cutoff = Date.now() - ttlMs;
  const filtered = runs.filter((r) => {
    const end = r.finishedAt ? new Date(r.finishedAt).getTime() : new Date(r.startedAt).getTime();
    return end >= cutoff;
  });
  filtered.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
  return filtered.slice(0, maxRuns);
}

export async function pruneRuns(
  stateDir: string,
  ttlMs: number = getTtl(),
  maxRuns: number = getMaxRuns(stateDir),
): Promise<void> {
  const runsFile = getRunsFile(stateDir);
  return withLock(runsFile, () => {
    const runs = readJsonl(runsFile);
    const pruned = pruneList(runs, ttlMs, maxRuns);
    if (pruned.length !== runs.length) {
      writeJsonl(runsFile, pruned);
    }
  });
}

/**
 * One atomic status refresh: prune expired runs (TTL + maxEntries), annotate
 * dead/stuck processes, and persist — all under the runs-file lock. The
 * returned snapshot is guaranteed to match what lands on disk, so callers can
 * print it directly without a follow-up unlocked `saveRuns` racing
 * `addRun`/`updateRun` or a fire-and-forget `pruneRuns`.
 */
export async function refreshRuns(
  stateDir: string,
  ttlMs: number = getTtl(),
  maxRuns: number = getMaxRuns(stateDir),
): Promise<RunRecord[]> {
  const runsFile = getRunsFile(stateDir);
  return withLock(runsFile, () => {
    const pruned = pruneList(readJsonl(runsFile), ttlMs, maxRuns);
    const annotated = detectStuck(pruned);
    writeJsonl(runsFile, annotated);
    return annotated;
  });
}

export function getLogMtime(logFile: string): number | null {
  try {
    return statSync(logFile).mtimeMs;
  } catch {
    return null;
  }
}

/** Read-only: returns annotated copy; caller must persist via saveRuns() if needed. */
export function detectStuck(
  runs: RunRecord[],
  opts?: { getProcessTicks?: (pid: number) => number | null },
): RunRecord[] {
  const ticks = opts?.getProcessTicks ?? getProcessTicks;
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
      // Claude-family agents (claude -p etc.) buffer stdout until exit, so
      // the log stays empty for the whole run even while the process is
      // actively running sub-agents. Use CPU activity as the tie-breaker:
      // a process doing meaningful work is not stuck regardless of log silence.
      const cpuMs = ticks(r.pid);
      if (cpuMs === null) {
        // /proc unreadable (gone, no perm). Fall back to old heuristic.
        return { ...r, status: 'stuck' as const };
      }
      if (cpuMs < STUCK_CPU_MS_THRESHOLD) {
        return { ...r, status: 'stuck' as const };
      }
      return r;
    }

    return r;
  });
}

function getTtl(): number {
  const env = process.env.AT_STATUS_TTL_MS;
  return env ? Number(env) : DEFAULT_TTL_MS;
}
