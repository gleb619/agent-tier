import { spawn } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { isPidAlive } from "../process-utils";

/**
 * Background compose jobs: a detached `at compose …` process whose pid/log live under
 * `<stateDir>/compose-jobs/` (project `.at/` when it exists, else `~/.at/` — same resolution as runs).
 * Deliberately separate from runs.jsonl: a job is a long-lived loop that spawns many runs.
 */

export interface JobRecord {
  name: string;
  pid: number;
  startedAt: string;
  cwd: string;
  logFile: string;
  /** The `at compose …` argv the job was started with (minus the background flags). */
  args: string[];
}

export interface JobStatus extends JobRecord {
  alive: boolean;
}

const JOBS_DIR = "compose-jobs";
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function jobsDir(stateDir: string): string {
  return path.join(stateDir, JOBS_DIR);
}

function recordFile(stateDir: string, name: string): string {
  return path.join(jobsDir(stateDir), `${name}.json`);
}

export function assertJobName(name: string): void {
  if (!NAME_RE.test(name)) throw new Error(`invalid job name '${name}' (letters, digits, . _ - only)`);
}

/** Default job name: the task id for `--task T7`, else `loop`. */
export function defaultJobName(taskId: string | undefined): string {
  return taskId ? taskId.toLowerCase() : "loop";
}

/**
 * Child argv for the detached process: everything after the `compose` token, with the flags that
 * only make sense in the foreground parent (`--background`, `--name <n>`) removed.
 */
export function buildJobArgs(rawArgs: string[]): string[] {
  const at = rawArgs.indexOf("compose");
  const rest = at === -1 ? rawArgs : rawArgs.slice(at);
  const out: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === "--background") continue;
    if (a === "--name") {
      i++;
      continue;
    }
    if (a.startsWith("--name=")) continue;
    out.push(a);
  }
  return out;
}

export function readJob(stateDir: string, name: string): JobStatus | undefined {
  try {
    const rec = JSON.parse(readFileSync(recordFile(stateDir, name), "utf8")) as JobRecord;
    return { ...rec, alive: isPidAlive(rec.pid) };
  } catch {
    return undefined;
  }
}

export function listJobs(stateDir: string): JobStatus[] {
  const dir = jobsDir(stateDir);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => readJob(stateDir, f.slice(0, -".json".length)))
    .filter((j): j is JobStatus => j !== undefined)
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
}

export interface StartJobOptions {
  stateDir: string;
  name: string;
  /** Output of {@link buildJobArgs}. */
  args: string[];
  cwd: string;
  /** Binary to re-invoke (default `$AT_BIN` or `at`, matching how compose already shells out). */
  bin?: string;
}

/** Spawn the detached loop; refuses to start a second live job with the same name. */
export function startJob(o: StartJobOptions): JobRecord {
  assertJobName(o.name);
  const existing = readJob(o.stateDir, o.name);
  if (existing?.alive) throw new Error(`job '${o.name}' already running (pid ${existing.pid})`);

  mkdirSync(jobsDir(o.stateDir), { recursive: true });
  const logFile = path.join(jobsDir(o.stateDir), `${o.name}.log`);
  const fd = openSync(logFile, "a");
  try {
    const child = spawn(o.bin ?? process.env.AT_BIN ?? "at", o.args, {
      cwd: o.cwd,
      detached: true,
      stdio: ["ignore", fd, fd],
      env: { ...process.env, AT_COMPOSE_JOB: o.name },
    });
    child.on("error", () => {});
    child.unref();
    if (!child.pid) throw new Error("failed to spawn background job");
    const rec: JobRecord = {
      name: o.name,
      pid: child.pid,
      startedAt: new Date().toISOString(),
      cwd: o.cwd,
      logFile,
      args: o.args,
    };
    writeFileSync(recordFile(o.stateDir, o.name), `${JSON.stringify(rec, null, 2)}\n`);
    return rec;
  } finally {
    closeSync(fd);
  }
}

/**
 * Ask a job to stop. The loop treats the first SIGTERM as "finish the in-flight task, then exit"
 * (resumable via state.json); `force` is SIGKILL for an immediate stop.
 */
export function stopJob(stateDir: string, name: string, force: boolean): JobStatus {
  const job = readJob(stateDir, name);
  if (!job) throw new Error(`job not found: ${name}`);
  if (!job.alive) return job;
  const signal = force ? "SIGKILL" : "SIGTERM";
  try {
    process.kill(-job.pid, signal); // detached ⇒ process-group leader
  } catch {
    process.kill(job.pid, signal);
  }
  return job;
}

export function tailLog(logFile: string, lines: number): string {
  try {
    return readFileSync(logFile, "utf8")
      .split("\n")
      .slice(-lines - 1)
      .join("\n");
  } catch {
    return "";
  }
}
