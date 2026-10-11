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
 *   1. drain any naming jobs queued by earlier lock timeouts (best-effort)
 *   2. poll the agent pid with `isPidAlive` every POLL_INTERVAL_MS
 *   3. when the pid is gone, mark the run record `done` with `exitCode: null`
 *      (the exit status of a process that is not our child is unknowable)
 *   4. when `AT_NAME_RUN=1`, name the run via `src/naming` — reflectively,
 *      AFTER the run finished, fed the tail of the run log; awaited before
 *      exit so the name reaches runs.jsonl while this process still lives
 *   5. optionally run the `--callback` command with the same `AT_*` env
 *      contract as `executeCallback` in runner.ts, except `AT_EXIT_CODE=0`
 *      (plus `AT_RUN_NAME`, which the supervisor knows by then)
 *   6. exit 0
 *
 * It intentionally does NOT call `recordResult` (agent health): failure
 * detection is impossible without the real exit code, so health tracking stays
 * a `--wait` / `-s` feature. A non-zero callback exit is only logged to the
 * run log file — the supervisor never fails because of it.
 */
import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { recordResult } from "./health";
import { applyRunName, drainNamingQueue, readLogTail } from "./naming";
import { isPidAlive } from "./process-utils";
import { UNNAMED_PLACEHOLDER, updateRun } from "./run-store";
import { getStateFilePath } from "./state-dir";

export const POLL_INTERVAL_MS = 2000;
/**
 * While the agent is alive, append a heartbeat line to the run log at this
 * interval: near-silent agents (mm-code, pi) otherwise leave the log empty
 * between the model banner and completion, and progress can only be judged
 * via the worktree git status. Also keeps live runs from being flagged
 * `stuck` (30 min without log activity) while their pid is still healthy.
 */
export const HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000;

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
  /** Optional post-agent verify command (forwarded via `AT_VERIFY_CMD`). */
  verify?: string;
  /** Agent's working directory (forwarded via `AT_CWD`) — verify runs there when set. */
  cwd?: string;
  /**
   * Ask the supervisor to name the run (forwarded via `AT_NAME_RUN=1`). Set by
   * the default detached path, whose parent CLI exits before a namer provider
   * can answer; blocking modes name the run in-process instead.
   */
  nameRun?: boolean;
}

/** Absolute path of the compiled supervisor entry (next to this module). */
export function getRunWatchScript(): string {
  return path.join(__dirname, "run-watch.js");
}

/**
 * Serialise the options into the supervisor argv. The prompt is *not* passed
 * as an argument (argv is world-readable) — it travels via `AT_PROMPT`.
 */
export function buildRunWatchArgs(o: RunWatchOptions): string[] {
  const args = [String(o.pid), o.runId, o.stateDir, o.agent, String(o.tier), o.logFile];
  if (o.callback?.trim()) args.push(o.callback.trim());
  return args;
}

/**
 * Spawn the detached supervisor. Best-effort: if the spawn itself fails the
 * run still happened, so the error is swallowed (the run record simply stays
 * `running` until `detectStuck` in run-store reconciles it).
 */
export function spawnRunWatch(o: RunWatchOptions): void {
  try {
    // Verify command + agent cwd travel via env so the supervisor argv stays
    // a fixed shape (we'd otherwise need to add/remove slots that depend on
    // whether --verify / --cwd were set).
    const env: NodeJS.ProcessEnv = { ...process.env, AT_PROMPT: o.prompt };
    if (o.verify?.trim()) env.AT_VERIFY_CMD = o.verify.trim();
    if (o.cwd) env.AT_CWD = o.cwd;
    if (o.nameRun) env.AT_NAME_RUN = "1";
    const child = spawn(process.execPath, [getRunWatchScript(), ...buildRunWatchArgs(o)], {
      detached: true,
      stdio: "ignore",
      env,
    });
    child.unref();
    child.once("error", () => {});
  } catch {
    // supervisor is a convenience — never fail the caller because of it
  }
}

/** Marker patterns providers emit when a quota/rate limit kills the run. */
const QUOTA_MARKERS = /(?:\b429\b|rate[ -]?limit|usage limit|quota|weekly limit|plan limit)/i;
/** How much of the log tail to scan — markers appear at the very end. */
const QUOTA_SCAN_BYTES = 64 * 1024;

/**
 * Best-effort: true (with the matched marker) when the end of the run log
 * looks like a provider quota/rate-limit kill, false on no match or any
 * read error.
 */
export function detectQuotaLimit(logFile: string): string | null {
  try {
    const content = readFileSync(logFile, "utf8");
    const tail = content.length > QUOTA_SCAN_BYTES ? content.slice(-QUOTA_SCAN_BYTES) : content;
    const m = tail.match(QUOTA_MARKERS);
    return m ? m[0] : null;
  } catch {
    return null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function runCallback(
  callback: string,
  o: RunWatchOptions,
  status: "done" | "failed" = "done",
  name: string = UNNAMED_PLACEHOLDER,
): void {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    AT_RUN_ID: o.runId,
    AT_AGENT: o.agent,
    AT_TIER: String(o.tier),
    // Unknowable for a non-child pid; 0 keeps the contract stable.
    AT_EXIT_CODE: "0",
    AT_LOG_FILE: o.logFile,
    AT_PROMPT: o.prompt,
    AT_STATUS: status,
    AT_RUN_NAME: name,
  };

  const result = spawnSync(callback, [], { env, stdio: "ignore", shell: true });
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
    prompt: process.env.AT_PROMPT ?? "",
  };

  // Flush naming jobs queued by earlier lock timeouts — best-effort, silent,
  // and it overlaps with the supervised run.
  await drainNamingQueue(stateDir).catch(() => {});

  try {
    const startedAt = Date.now();
    let lastHeartbeat = startedAt;
    while (isPidAlive(pid)) {
      if (Date.now() - lastHeartbeat >= HEARTBEAT_INTERVAL_MS) {
        lastHeartbeat = Date.now();
        const elapsedMin = Math.round((lastHeartbeat - startedAt) / 60000);
        try {
          appendFileSync(logFile, `[at] heartbeat: ${agent} pid ${pid} alive, ${elapsedMin}m elapsed\n`);
        } catch {
          // log file may be gone — heartbeat is best-effort
        }
      }
      await sleep(POLL_INTERVAL_MS);
    }

    try {
      // Quota/rate-limit detection: agents killed by provider 429s (mm-code,
      // pi "Token Plan usage limit reached") die in seconds with the marker
      // as the last thing in their log. Without this check such runs would be
      // marked done and the agent would stay in the rotation.
      const quotaHit = detectQuotaLimit(logFile);
      if (quotaHit) {
        appendFileSync(
          logFile,
          `[at] run-watch: agent appears quota/rate-limited ("${quotaHit}"), marking run failed and recording agent failure\n`,
        );
      }
      await updateRun(stateDir, runId, {
        status: quotaHit ? "failed" : "done",
        finishedAt: new Date().toISOString(),
        // The exit code of a process that is not our direct child cannot be
        // observed; null signals "finished, status unknown". A quota kill is
        // the one case we can classify — use 1 so the failure is visible.
        exitCode: quotaHit ? 1 : null,
      });
      if (quotaHit) {
        // Feed the health system so repeated quota deaths auto-disable the
        // agent (same signal the blocking paths emit on non-zero exit).
        await recordResult(getStateFilePath(stateDir), agent, false).catch(() => {});
      }
    } catch (err) {
      try {
        appendFileSync(logFile, `[at] run-watch: updateRun failed: ${(err as Error).message}\n`);
      } catch {
        // ignore
      }
    }

    // Reflective naming, only after the run produced output: the log tail
    // gives the namer something to reflect on instead of the raw prompt
    // alone. Awaited (not fire-and-forget): the name must be in runs.jsonl
    // before this process exits, and the callback should see it.
    const named =
      process.env.AT_NAME_RUN === "1"
        ? await applyRunName({
            stateDir,
            runId,
            prompt: options.prompt,
            logFile,
            logTail: readLogTail(logFile),
            cwd: process.env.AT_CWD ?? process.cwd(),
          })
        : null;

    let finalStatus: "done" | "failed" = "done";
    const verifyCmd = process.env.AT_VERIFY_CMD?.trim();
    if (verifyCmd) {
      // Verify runs in AT_CWD when set (forwarded by the parent CLI's
      // options.cwd), else falls back to the supervisor's CWD — which IS
      // the parent's CWD for any realistic detached-run invocation (the
      // supervisor inherits cwd from the spawning `at` process).
      const verifyCwd = process.env.AT_CWD ?? process.cwd();
      const verifyResult = spawnSync(verifyCmd, [], { cwd: verifyCwd, shell: true, stdio: "ignore" });
      const verifyExit = verifyResult.status ?? 1;
      if (verifyExit === 0) {
        try {
          appendFileSync(logFile, `[at] verify ok: ${verifyCmd}\n`);
        } catch {
          // best effort
        }
      } else {
        finalStatus = "failed";
        try {
          appendFileSync(logFile, `[at] verify failed (exit ${verifyExit}): ${verifyCmd}\n`);
        } catch {
          // best effort
        }
        try {
          await updateRun(stateDir, runId, { status: finalStatus });
        } catch {
          // best effort
        }
      }
    }

    if (callback?.trim()) {
      runCallback(callback.trim(), options, finalStatus, named?.name ?? UNNAMED_PLACEHOLDER);
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
