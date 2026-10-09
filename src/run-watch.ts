/**
 * Background supervisor for non-blocking detached runs (`at` invoked without
 * `-s` and without `--wait`).
 *
 * The CLI spawns this file as a fully detached process (`process.execPath
 * dist/run-watch.js <pid> <runId> <stateDir> <agentName> <tier> <logFile>
 * [callbackCmd]`) right after printing the run box, then exits with code 0 so
 * the caller is never held hostage by a long-running agent (CI timeouts, the
 * 120s Bash-tool limit, ...).
 *
 * Responsibilities — deliberately minimal:
 *   1. poll the agent pid with `isPidAlive` every POLL_INTERVAL_MS
 *   2. when the pid is gone, mark the run record `done` with `exitCode: null`
 *      (the exit status of a process that is not our child is unknowable)
 *   3. optionally run the `--callback` command with the same `AT_*` env
 *      contract as `executeCallback` in runner.ts, except `AT_EXIT_CODE=0`
 *   4. exit 0
 *
 * It intentionally does NOT call `recordResult` (agent health): failure
 * detection is impossible without the real exit code, so health tracking stays
 * a `--wait` / `-s` feature. A non-zero callback exit is only logged to the
 * run log file — the supervisor never fails because of it.
 */
import { spawn, spawnSync } from 'child_process';
import { appendFileSync } from 'fs';
import path from 'path';

import { isPidAlive } from './process-utils';
import { updateRun } from './run-store';

export const POLL_INTERVAL_MS = 2000;

export interface RunWatchOptions {
  /** PID of the detached agent process to watch. */
  pid: number;
  runId: string;
  stateDir: string;
  agent: string;
  tier: number;
  logFile: string;
  /** Optional `--callback` shell command, executed once the pid dies. */
  callback?: string;
  /** Original prompt, forwarded to the callback as `AT_PROMPT`. */
  prompt: string;
}

/** Absolute path of the compiled supervisor entry (next to this module). */
export function getRunWatchScript(): string {
  return path.join(__dirname, 'run-watch.js');
}

/**
 * Serialise the options into the supervisor argv. The prompt is *not* passed
 * as an argument (argv is world-readable) — it travels via `AT_PROMPT`.
 */
export function buildRunWatchArgs(o: RunWatchOptions): string[] {
  const args = [String(o.pid), o.runId, o.stateDir, o.agent, String(o.tier), o.logFile];
  if (o.callback && o.callback.trim()) args.push(o.callback.trim());
  return args;
}

/**
 * Spawn the detached supervisor. Best-effort: if the spawn itself fails the
 * run still happened, so the error is swallowed (the run record simply stays
 * `running` until `detectStuck` in run-store reconciles it).
 */
export function spawnRunWatch(o: RunWatchOptions): void {
  try {
    const child = spawn(process.execPath, [getRunWatchScript(), ...buildRunWatchArgs(o)], {
      detached: true,
      stdio: 'ignore',
      env: { ...process.env, AT_PROMPT: o.prompt },
    });
    child.unref();
    child.once('error', () => {});
  } catch {
    // supervisor is a convenience — never fail the caller because of it
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function runCallback(callback: string, o: RunWatchOptions): void {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    AT_RUN_ID: o.runId,
    AT_AGENT: o.agent,
    AT_TIER: String(o.tier),
    // Unknowable for a non-child pid; 0 keeps the contract stable.
    AT_EXIT_CODE: '0',
    AT_LOG_FILE: o.logFile,
    AT_PROMPT: o.prompt,
    AT_STATUS: 'done',
  };

  const result = spawnSync(callback, [], { env, stdio: 'ignore', shell: true });
  if (result.status !== 0) {
    try {
      appendFileSync(o.logFile, `[at] callback exited with code ${result.status ?? 1}: ${callback}\n`);
    } catch {
      // log file may be gone — nothing else to do
    }
  }
}

/**
 * Supervisor main loop. Exported (rather than only invoked from the
 * `require.main` guard) so tests can drive it without exiting vitest.
 *
 * @returns process exit code (always 0 on success)
 */
export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  const [pidArg, runId, stateDir, agent, tierArg, logFile, callback] = argv;
  const pid = Number(pidArg);
  if (!Number.isInteger(pid) || pid <= 0) {
    process.stderr.write(`[at] run-watch: invalid pid "${pidArg}"\n`);
    return 1;
  }
  const tier = Number(tierArg);

  const options: RunWatchOptions = {
    pid,
    runId,
    stateDir,
    agent,
    tier: Number.isFinite(tier) ? tier : 2,
    logFile,
    callback,
    prompt: process.env.AT_PROMPT ?? '',
  };

  try {
    while (isPidAlive(pid)) {
      await sleep(POLL_INTERVAL_MS);
    }

    try {
      await updateRun(stateDir, runId, {
        status: 'done',
        finishedAt: new Date().toISOString(),
        // The exit code of a process that is not our direct child cannot be
        // observed; null signals "finished, status unknown".
        exitCode: null,
      });
    } catch (err) {
      try {
        appendFileSync(logFile, `[at] run-watch: updateRun failed: ${(err as Error).message}\n`);
      } catch {
        // ignore
      }
    }

    if (callback && callback.trim()) {
      runCallback(callback.trim(), options);
    }

    return 0;
  } catch (err) {
    try {
      appendFileSync(logFile, `[at] run-watch: fatal: ${(err as Error).message}\n`);
    } catch {
      // ignore
    }
    return 1;
  }
}

if (require.main === module) {
  void main().then(
    (code) => process.exit(code),
    (err: Error) => {
      process.stderr.write(`[at] run-watch: ${err.message}\n`);
      process.exit(1);
    },
  );
}
