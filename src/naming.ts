/**
 * Run naming — the one place that turns a prompt (+ optional run output)
 * into a persisted `RunRecord.name`.
 *
 * Two callers share this path:
 *  - `runner.run()` in blocking modes (`-s`, `--wait`, `--sse`), after the
 *    agent result is known, reflecting on the tail of the run's log;
 *  - `run-watch.main()` for the default detached run, after the supervised
 *    pid dies — the supervisor is the only process left alive by then.
 *
 * Naming is REFLECTIVE (post-completion, fed the log tail), SERIALIZED
 * (a `namer.lock` file mutex — a local ollama is a busy single resource and
 * concurrent prompts overload it), and DEFERRED: when the lock cannot be
 * acquired in time the job lands in `naming-queue.jsonl` and is retried by
 * `drainNamingQueue` (called from `applyRunName`, `run-watch.main` and
 * `runStatus`).
 *
 * Never throws: naming is enrichment, so any failure resolves to `null` and
 * the run keeps its `UNNAMED_PLACEHOLDER` name.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { withLock } from "./lock";
import { generateSessionName } from "./namer";
import { updateRun } from "./run-store";

/** Generous — naming is best-effort, but a busy local model can take a while. */
export const NAMER_LOCK_TIMEOUT_MS = 120_000;
/** How much of the run log tail feeds the reflection context. */
export const REFLECT_TAIL_BYTES = 4 * 1024;

export interface ApplyRunNameOpts {
  stateDir: string;
  runId: string;
  prompt: string;
  /** When set, the winning provider is appended to the run log (supervisor path). */
  logFile?: string;
  /** Tail of the run's log — the reflective context the namer reasons over. */
  logTail?: string;
  /** Run working directory, folded into the context header when set. */
  cwd?: string;
  signal?: AbortSignal;
  /** Silence provider warnings (callers with strict stderr, e.g. status --json). */
  quiet?: boolean;
  /** Injectable lock timeout — tests use a small value to force the queue path. */
  lockTimeoutMs?: number;
}

export interface AppliedRunName {
  name: string;
  provider: string;
}

export interface NamingJob {
  runId: string;
  stateDir: string;
  logFile?: string;
  prompt?: string;
  enqueuedAt: string;
}

export function getNamingQueueFile(stateDir: string): string {
  return path.join(stateDir, "naming-queue.jsonl");
}

/** lock.ts derives `<dir>/locks/<name>.lock` from the target file path. */
function getNamerLockTarget(stateDir: string): string {
  return path.join(stateDir, "namer.lock");
}

/** Last `maxBytes` of a log file; '' on any read error or empty file. */
export function readLogTail(logFile: string, maxBytes: number = REFLECT_TAIL_BYTES): string {
  try {
    const content = readFileSync(logFile, "utf8");
    if (!content) return "";
    return content.length > maxBytes ? content.slice(-maxBytes) : content;
  } catch {
    return "";
  }
}

function buildReflectContext(logTail?: string, cwd?: string): string | undefined {
  const tail = (logTail ?? "").trim();
  if (!tail) return undefined;
  const header = cwd ? `--- run log tail (cwd: ${cwd}) ---` : "--- run log tail ---";
  return `${header}\n${tail}`;
}

/** Provider call + persistence. Caller must hold the namer lock. Never throws. */
async function nameRunLocked(opts: ApplyRunNameOpts): Promise<AppliedRunName | null> {
  const context = buildReflectContext(opts.logTail, opts.cwd);
  const result = await generateSessionName(opts.prompt, opts.stateDir, {
    ...(opts.signal ? { signal: opts.signal } : {}),
    ...(context ? { context } : {}),
    ...(opts.quiet ? { quiet: true } : {}),
  });
  // provider === null means every namer failed and we got the fallback name —
  // the record already says `unnamed`, so there is nothing to write.
  if (!result.provider) return null;
  await updateRun(opts.stateDir, opts.runId, { name: result.name });
  if (opts.logFile) {
    try {
      appendFileSync(opts.logFile, `[at] namer: ${result.name} (via ${result.provider})\n`);
    } catch {
      // log file may be gone — the run record is what matters
    }
  }
  return { name: result.name, provider: result.provider };
}

function enqueueNamingJob(job: NamingJob): void {
  mkdirSync(job.stateDir, { recursive: true });
  // Line stays small (<4 KB): runId + paths + prompt head only — the log tail
  // is re-read from logFile at drain time. O_APPEND makes this atomic enough.
  const small: NamingJob = { ...job, prompt: job.prompt ? job.prompt.slice(0, 500) : job.prompt };
  appendFileSync(getNamingQueueFile(job.stateDir), `${JSON.stringify(small)}\n`, "utf8");
}

function parseQueueLine(line: string): NamingJob | null {
  try {
    const job = JSON.parse(line) as NamingJob;
    return job && typeof job.runId === "string" ? job : null;
  } catch {
    return null;
  }
}

function readQueue(queueFile: string): NamingJob[] {
  try {
    const raw = readFileSync(queueFile, "utf8");
    if (!raw.trim()) return [];
    const jobs: NamingJob[] = [];
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      const job = parseQueueLine(line);
      if (job) jobs.push(job);
    }
    return jobs;
  } catch {
    return [];
  }
}

/**
 * Best-effort flush of `naming-queue.jsonl`: for each queued job, re-attempt
 * naming with reflection from the run's stored log file (the tail is re-read
 * at drain time). Successfully named jobs are removed; failures stay queued
 * for the next drain. Corrupt/missing queue file is treated as empty.
 * Always silent — called from `runStatus`, which must not pollute `--json`.
 */
export async function drainNamingQueue(stateDir: string): Promise<void> {
  try {
    const queueFile = getNamingQueueFile(stateDir);
    if (!existsSync(queueFile)) return;
    const jobs = readQueue(queueFile);
    const namedIds = new Set<string>();
    for (const job of jobs) {
      if (await nameQueuedJob(job)) namedIds.add(job.runId);
    }
    await withLock(queueFile, () => {
      // Re-read under the lock: another process may have enqueued while we
      // were naming. Drop only what we named; keep everything else.
      const fresh = readQueue(queueFile);
      const kept = fresh.filter((j) => !namedIds.has(j.runId));
      writeFileSync(queueFile, kept.length > 0 ? `${kept.map((j) => JSON.stringify(j)).join("\n")}\n` : "", "utf8");
    });
  } catch {
    // naming is enrichment — never break the caller
  }
}

/** True when the job was named (or has nothing to name from and can drop out). */
async function nameQueuedJob(job: NamingJob): Promise<boolean> {
  try {
    const logTail = job.logFile ? readLogTail(job.logFile) : "";
    if (!job.prompt?.trim() && !logTail.trim()) return true;
    return await withLock(
      getNamerLockTarget(job.stateDir),
      async () =>
        (await nameRunLocked({
          stateDir: job.stateDir,
          runId: job.runId,
          prompt: job.prompt ?? "",
          logFile: job.logFile,
          logTail,
          quiet: true,
        })) !== null,
      NAMER_LOCK_TIMEOUT_MS,
    );
  } catch {
    return false;
  }
}

export async function applyRunName(opts: ApplyRunNameOpts): Promise<AppliedRunName | null> {
  if (!opts.prompt?.trim()) return null;
  // Flush stale jobs first so a freed namer lock benefits queued runs too.
  try {
    await drainNamingQueue(opts.stateDir);
  } catch {
    // silent — drain must never break naming
  }
  let named: AppliedRunName | null = null;
  try {
    // Naming failures resolve null inside the lock — only a lock failure
    // (timeout / steal error) may fall through to the queue.
    named = await withLock(
      getNamerLockTarget(opts.stateDir),
      () => nameRunLocked(opts).catch(() => null),
      opts.lockTimeoutMs ?? NAMER_LOCK_TIMEOUT_MS,
    );
  } catch {
    // Lock timeout (busy namer elsewhere) — defer, don't lose the name.
    try {
      enqueueNamingJob({
        runId: opts.runId,
        stateDir: opts.stateDir,
        logFile: opts.logFile,
        prompt: opts.prompt,
        enqueuedAt: new Date().toISOString(),
      });
    } catch {
      // queue write failed — the run simply stays unnamed
    }
    return null;
  }
  return named;
}
