import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, writeSync } from "node:fs";
import path from "node:path";
import { AgentError } from "./agent-error";
import { applyNormkaFlag } from "./agents/normka-flag";
import { AGENTS, type AgentDef } from "./agents/registry";
import { getLineAgents, loadConfig } from "./config";
import { filterHealthy, isDeactivated, loadHealth, recordResult } from "./health";
import { applyRunName, readLogTail } from "./naming";
import { type Hub, type NotifyEvent, setupNotify, startHub, tailLogFile } from "./notify";
import type { RunOptions } from "./resolver";
import { addRun, loadRuns, UNNAMED_PLACEHOLDER, updateRun } from "./run-store";
import { spawnRunWatch } from "./run-watch";
import { assertRealAgentAllowed, assertSafeToStart, currentNestingDepth, startRssWatchdog } from "./safety";
import { runSandboxTest } from "./sandbox";
import { getStateFile, pickAgent } from "./scheduler";
import { getStateFilePath } from "./state-dir";

interface TrackedChild {
  pid: number;
  detached: boolean;
}

const activeChildren: TrackedChild[] = [];
let processHub: Hub | undefined;
let processHubPromise: Promise<Hub> | undefined;

function trackChild(pid: number, detached: boolean): void {
  activeChildren.push({ pid, detached });
}

function untrackChild(pid: number): void {
  const idx = activeChildren.findIndex((c) => c.pid === pid);
  if (idx !== -1) activeChildren.splice(idx, 1);
}

export function killActiveChildren(): void {
  for (const child of activeChildren) {
    try {
      if (child.detached) {
        process.kill(-child.pid, "SIGKILL");
      } else {
        process.kill(child.pid, "SIGKILL");
      }
    } catch {
      // ignore — process may already be dead
    }
  }
  activeChildren.length = 0;
}

// AgentError lives in src/agent-error.ts so non-runner modules (e.g. sandbox)
// can throw the same type without creating a circular import. Re-exported here
// for backwards compatibility.
export { AgentError } from "./agent-error";

export type Spawner = (agent: AgentDef, options: RunOptions, runId: string) => Promise<number>;

export interface LaunchResult {
  child: ReturnType<typeof spawn>;
  runId: string;
  logFile: string;
  agent: AgentDef;
}

export interface CallbackContext {
  runId: string;
  agent: string;
  tier: number;
  exitCode: number;
  logFile: string;
  prompt: string;
  status: "done" | "failed";
  name: string;
}

export function executeCallback(command: string | undefined, context: CallbackContext): void {
  if (!command?.trim()) return;

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    AT_RUN_ID: context.runId,
    AT_AGENT: context.agent,
    AT_TIER: String(context.tier),
    AT_EXIT_CODE: String(context.exitCode),
    AT_LOG_FILE: context.logFile,
    AT_PROMPT: context.prompt,
    AT_STATUS: context.status,
    AT_RUN_NAME: context.name,
  };

  const cmd = command.trim();
  const result = spawnSync(cmd, [], { env, stdio: "inherit", shell: true });
  if (result.status !== 0) {
    console.warn(`[at] callback exited with code ${result.status ?? 1}: ${cmd}`);
  }
}

/**
 * Run a post-agent verification command. Always runs in a shell so users can
 * string commands together (`make test && make lint`). On non-zero exit the
 * caller is expected to fail the run.
 *
 * Output is captured (stdout+stderr merged) so the run log can include the
 * first lines on failure — but only a slice is appended to keep logs short.
 */
export function runVerify(cmd: string, cwd: string): { exitCode: number; output: string } {
  const result = spawnSync(cmd, [], {
    cwd,
    shell: true,
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
  });
  const stdout = typeof result.stdout === "string" ? result.stdout : "";
  const stderr = typeof result.stderr === "string" ? result.stderr : "";
  // Some shells (busybox) print to stdout even on failure; merge so the log
  // line on failure captures everything the user might want to see.
  return { exitCode: result.status ?? 1, output: stdout + stderr };
}

/**
 * Append the standard `[at] verify ...` log line. Kept tiny so a long
 * failing test output doesn't drown the run log — only the first ~20 lines.
 */
export function appendVerifyLogLine(
  logFile: string,
  outcome: "ok" | "failed",
  cmd: string,
  exitCode: number,
  output?: string,
): void {
  try {
    if (outcome === "ok") {
      appendFileSync(logFile, `[at] verify ok: ${cmd}\n`);
      return;
    }
    const head = (output ?? "").split("\n").slice(0, 20).join("\n");
    appendFileSync(
      logFile,
      `[at] verify failed (exit ${exitCode}): ${cmd}\n${head}${head && !head.endsWith("\n") ? "\n" : ""}`,
    );
  } catch {
    // log file may be gone — best effort
  }
}

interface LaunchExtras {
  runId?: string;
  extraArgs?: string[];
  /** When set, replaces baseArgs entirely (caller already computed full argv). */
  overrideArgs?: string[];
  extraPrompt?: string;
  extraEnv?: Record<string, string>;
  /**
   * Session name forwarded to the child as `AT_RUN_NAME` and persisted on the
   * run record. Stays at `UNNAMED_PLACEHOLDER` until the namer resolves — or
   * forever when every provider fails. Always populated so downstream columns
   * stay stable.
   */
  name?: string;
}

/**
 * Shell-quoted `node /abs/path/to/cli.js` (or just `at` if the binary is
 * directly executable). Exposed to child agents as AT_BIN so they can shell
 * out to `at discuss ...` without re-deriving the path.
 */
export function getAtBin(): string {
  const exe = process.execPath;
  const script = process.argv[1] || exe;
  return `${shellQuote(exe)} ${shellQuote(script)}`;
}

function shellQuote(s: string): string {
  if (/^[a-zA-Z0-9_/.-]+$/.test(s)) return s;
  return `'${s.replace(/'/g, "'\\''")}'`;
}

/**
 * Drop a one-line shim in the agent's cwd that sets the right `at` env and
 * execs `at`. Solves the cline v3 hub-daemon env-staleness problem: cline
 * runs its tool subprocesses inside a long-lived hub whose env was
 * captured at first start, so subsequent spawns' AT_STATE_DIR / AT_RUN_ID
 * are ignored and the host channel silently writes to the wrong state
 * dir. The shim is the only thing the LLM can rely on.
 */
export function writeHostChannelShim(opts: { cwd?: string; atBin: string; stateDir: string; runId: string }): string {
  const { cwd, atBin, stateDir, runId } = opts;
  if (!cwd) return "";
  try {
    const fs = require("node:fs") as typeof import("fs");
    fs.mkdirSync(cwd, { recursive: true });
    const shimPath = path.join(cwd, ".at-host-channel.sh");
    const body =
      "#!/usr/bin/env bash\n" +
      `# Auto-generated by agent-tier per-run. Sets the right at env and execs \`at\`.\n` +
      `export AT_STATE_DIR=${shellQuote(stateDir)}\n` +
      `export AT_RUN_ID=${shellQuote(runId)}\n` +
      `export AT_BIN=${shellQuote(atBin)}\n` +
      `exec ${atBin} "$@"\n`;
    fs.writeFileSync(shimPath, body, { mode: 0o755 });
    return shimPath;
  } catch {
    // Best-effort: never fail a run because the shim could not be written.
    return "";
  }
}

export async function launchAgent(agent: AgentDef, options: RunOptions, extras?: LaunchExtras): Promise<LaunchResult> {
  assertRealAgentAllowed(agent, AGENTS.includes(agent));
  const runId = extras?.runId ?? generateRunId();
  const promptText = options.prompt + (extras?.extraPrompt ?? "");
  const baseArgs = applyNormkaFlag(agent, agent.buildArgs(promptText, options.model, options.cwd), promptText, {
    normka: options.normka,
  });
  let args: string[];
  if (extras?.overrideArgs) {
    args = extras.overrideArgs;
  } else if (extras?.extraArgs) {
    args = [...baseArgs, ...extras.extraArgs];
  } else {
    args = baseArgs;
  }
  const extraEnv = agent.buildEnv?.(options.model) ?? {};
  const env = { ...process.env, ...extraEnv, ...(options.env ?? {}), ...(extras?.extraEnv ?? {}) } as Record<
    string,
    string
  >;
  env.AT_RUN_NAME = extras?.name ?? UNNAMED_PLACEHOLDER;
  // Recursion guard: agents started by `at` must not start more `at` runs (see src/safety.ts).
  env.AT_DEPTH = String(currentNestingDepth() + 1);

  mkdirSync(options.logDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const logFile = path.join(options.logDir, `at-${timestamp}-${agent.name}.log`);
  const stdinData = agent.promptMode === "stdin" ? promptText : undefined;

  const logFd = openSync(logFile, "w");
  writeSync(logFd, `[at] runId: ${runId}\n`);

  const child = spawn(agent.bin(), args, {
    env,
    cwd: options.cwd,
    detached: true,
    stdio: stdinData ? ["pipe", logFd, logFd] : ["ignore", logFd, logFd],
  });

  if (child.pid === undefined) {
    writeSync(logFd, `[at] error: Failed to spawn ${agent.name}: no PID assigned\n`);
    closeSync(logFd);
    throw new Error(`Failed to spawn ${agent.name}: no PID assigned`);
  }

  closeSync(logFd);
  child.once("error", () => {});

  if (stdinData && child.stdin) {
    child.stdin.write(stdinData);
    child.stdin.end();
  }

  trackChild(child.pid, true);
  await addRun(options.stateDir, {
    runId,
    agent: agent.name,
    tier: agent.tier,
    pid: child.pid,
    prompt: options.prompt,
    logFile,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    exitCode: null,
    status: "running",
    name: extras?.name ?? UNNAMED_PLACEHOLDER,
  });

  return { child, runId, logFile, agent };
}

function printReport(result: LaunchResult, sseUrl?: string, name?: string): void {
  console.log(`[at] ┌──────────────────────────────────`);
  console.log(`[at] │ Run ID:  ${result.runId}`);
  console.log(`[at] │ Name:    ${name ?? UNNAMED_PLACEHOLDER}`);
  console.log(`[at] │ Agent:   ${result.agent.name} (tier ${result.agent.tier})`);
  console.log(`[at] │ PID:     ${result.child.pid}`);
  console.log(`[at] │ Log:     ${result.logFile}`);
  console.log(`[at] │ Status:  running`);
  if (sseUrl) console.log(`[at] │ SSE:     ${sseUrl}`);
  console.log(`[at] └──────────────────────────────────`);
}

export function closeProcessHub(): Promise<void> {
  const hub = processHub;
  processHub = undefined;
  processHubPromise = undefined;
  if (!hub) return Promise.resolve();
  // Brief grace so SSE clients reading over `/events/<runId>` still get the
  // final `done` event we published seconds ago, then tear down sockets+server.
  // When no client ever connected, close immediately so subsequent `at notify`
  // POSTs (which still need a live hub) do not stall.
  const grace = hub.hadActiveClients ? 300 : 0;
  return new Promise((resolve) => {
    setTimeout(() => {
      hub.close().then(
        () => resolve(),
        () => resolve(),
      );
    }, grace).unref();
  });
}

export async function getProcessHub(options: RunOptions): Promise<Hub> {
  if (processHub) return processHub;
  if (processHubPromise) return processHubPromise;
  processHubPromise = startHub({ stateDir: options.stateDir, port: options.ssePort });
  processHub = await processHubPromise;
  return processHub;
}

async function streamLogsAndWatch(result: LaunchResult, options: RunOptions): Promise<number> {
  const { child, runId, logFile, agent } = result;
  const timeoutMs = options.timeout;

  const agentExit = new Promise<{ code: number | null; signal: string | null }>((resolve) => {
    child.on("close", (code, signal) => resolve({ code, signal }));
    child.on("error", () => resolve({ code: 1, signal: null }));
  });

  let timeoutHandle: ReturnType<typeof setTimeout>;
  const timeoutP = new Promise<{ code: null; signal: "SIGKILL" }>((resolve) => {
    timeoutHandle = setTimeout(() => resolve({ code: null, signal: "SIGKILL" }), timeoutMs);
  });

  // Use in-process log-streamer for real-time filtering.
  // Falls back to plain tail -f if --no-chop or the built streamer is missing.
  const logStreamerJs = path.join(__dirname, "log-streamer.js");
  const useStreamer = !options.noChop && existsSync(logStreamerJs);

  const streamCmd = useStreamer ? "node" : "tail";
  const streamArgs = useStreamer ? [logStreamerJs, "--log", logFile, "--pid", String(child.pid!)] : ["-f", logFile];

  const streamChild = spawn(streamCmd, streamArgs, {
    stdio: ["ignore", "pipe", "pipe"],
    detached: false,
  });

  let streamPid: number | undefined;
  if (streamChild.pid !== undefined) {
    streamPid = streamChild.pid;
    trackChild(streamPid, false);
  }

  const ignoreEpipe = (err: Error) => {
    if ((err as NodeJS.ErrnoException).code !== "EPIPE") {
      console.error(`[at] stdout/stderr error: ${err.message}`);
    }
  };
  process.stdout.on("error", ignoreEpipe);
  process.stderr.on("error", ignoreEpipe);

  streamChild.stdout?.pipe(process.stdout, { end: false });
  streamChild.stderr?.pipe(process.stderr, { end: false });

  streamChild.on("error", (err) => {
    console.error(`[at] log stream error (logs at ${logFile}): ${err.message}`);
  });

  const stopRssWatchdog = startRssWatchdog(child.pid!, (rss) => {
    try {
      appendFileSync(logFile, `[at] safety: killed ${agent.name}, process tree RSS ${Math.round(rss)}MB over limit\n`);
    } catch {}
  });
  const { code, signal } = await Promise.race([agentExit, timeoutP]);
  stopRssWatchdog();
  clearTimeout(timeoutHandle!);

  if (streamPid !== undefined) {
    try {
      streamChild.kill("SIGKILL");
    } catch {}
    untrackChild(streamPid);
  }
  untrackChild(child.pid!);

  process.stdout.off("error", ignoreEpipe);
  process.stderr.off("error", ignoreEpipe);

  if (signal === "SIGKILL") {
    try {
      process.kill(-child.pid!, "SIGKILL");
    } catch {}
    try {
      appendFileSync(logFile, `[at] timeout: killed after ${timeoutMs}ms\n`);
    } catch {}
    await updateRun(options.stateDir, runId, {
      status: "failed",
      finishedAt: new Date().toISOString(),
      exitCode: 1,
    });
    throw new Error(`${agent.name} killed after ${timeoutMs}ms timeout`);
  }

  const exitCode = code ?? 1;
  let status: "done" | "failed" = exitCode === 0 ? "done" : "failed";
  await updateRun(options.stateDir, runId, {
    status,
    finishedAt: new Date().toISOString(),
    exitCode,
  });

  // Post-agent verify hook: fail the run when the command exits non-zero.
  // On failure: status flipped to 'failed', log line appended, --callback
  // still fires (with AT_STATUS=failed per spec), and AgentError is thrown so
  // `run()`'s retry-with-next-agent logic applies (blocking modes only).
  // Agent exitCode is kept on the record — the failure source is visible
  // via the log line.
  if (options.verify?.trim()) {
    const verifyCmd = options.verify.trim();
    const verifyCwd = options.cwd ?? process.cwd();
    const { exitCode: verifyExit, output } = runVerify(verifyCmd, verifyCwd);
    if (verifyExit === 0) {
      appendVerifyLogLine(logFile, "ok", verifyCmd, 0);
    } else {
      status = "failed";
      await updateRun(options.stateDir, runId, { status });
      appendVerifyLogLine(logFile, "failed", verifyCmd, verifyExit, output);
      executeCallback(options.callback, {
        runId,
        agent: agent.name,
        tier: agent.tier,
        exitCode,
        logFile,
        prompt: options.prompt,
        status,
        name: options.runName ?? UNNAMED_PLACEHOLDER,
      });
      throw new AgentError(`verify failed (exit ${verifyExit}): ${verifyCmd}`, verifyExit);
    }
  }

  executeCallback(options.callback, {
    runId,
    agent: agent.name,
    tier: agent.tier,
    exitCode,
    logFile,
    prompt: options.prompt,
    status,
    name: options.runName ?? UNNAMED_PLACEHOLDER,
  });

  return exitCode;
}

export async function run(options: RunOptions, agents: AgentDef[], spawner: Spawner = defaultSpawner): Promise<number> {
  const cleanup = () => {
    killActiveChildren();
    process.exit(1);
  };
  process.once("SIGTERM", cleanup);
  process.once("SIGINT", cleanup);

  try {
    assertSafeToStart(options.stateDir);
    const runId = generateRunId();
    const stateFilePath = getStateFilePath(options.stateDir);
    const healthState = loadHealth(stateFilePath);
    let candidates: AgentDef[];

    if (options.agent !== "auto") {
      if (isDeactivated(stateFilePath, options.agent, healthState)) {
        throw new Error(`Agent "${options.agent}" is deactivated. Enable it first with: at enable ${options.agent}`);
      }
      const named = agents.find((a) => a.name === options.agent);
      if (!named) throw new Error(`Unknown agent: ${options.agent}`);
      candidates = [named];
    } else {
      const isLineMode = options.tier === undefined;
      const poolAgents = isLineMode
        ? getLineAgents(agents, loadConfig())
        : agents.filter((a) => a.tier === options.tier);
      if (poolAgents.length === 0) {
        throw new Error(
          isLineMode
            ? "No agents available for line mode (line pool is empty)"
            : `No agents defined for tier ${options.tier}`,
        );
      }
      const enabled = poolAgents.filter((a) => !isDeactivated(stateFilePath, a.name, healthState));
      if (enabled.length === 0) {
        throw new Error(
          isLineMode ? "All line agents are deactivated" : `All tier-${options.tier} agents are deactivated`,
        );
      }
      const healthy = await filterHealthy(stateFilePath, enabled, healthState);
      if (healthy.length === 0) {
        console.warn(
          isLineMode
            ? "[at] all line agents are temporarily disabled, using full enabled pool"
            : `[at] all tier-${options.tier} agents are temporarily disabled, using full enabled pool`,
        );
        candidates = enabled;
      } else {
        candidates = healthy;
      }
    }

    const isNamed = options.agent !== "auto";
    const stateFile = getStateFile(options.stateDir);
    const schedKey = options.tier != null ? `tier-${options.tier}` : "line";
    const maxAttempts = isNamed ? 1 : 1 + Math.min(options.retries, candidates.length - 1);
    let agent = isNamed ? candidates[0] : await pickAgent(candidates, stateFile, schedKey);

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (attempt > 0) {
        agent = await pickAgent(candidates, stateFile, schedKey);
        console.warn("[at] retrying with next agent...");
      }

      let healthRecorded = false;
      try {
        const exitCode = await spawner(agent, options, runId);
        // Reflective naming, only after the agent result is known: the run
        // record holds the log file, whose tail gives the namer something to
        // reflect on instead of the raw prompt alone. Only the blocking modes
        // (`-s`, `--wait`, `--sse`) name here — they keep this process alive
        // for the whole run. The default detached mode exits right after the
        // run box, so it delegates naming to the supervisor
        // (`spawnRunWatch({ nameRun: true })`).
        let namedRun: Awaited<ReturnType<typeof applyRunName>> = null;
        if (!options.runName && (options.stream || options.wait || options.sse)) {
          const record = loadRuns(options.stateDir).find((r) => r.runId === runId);
          const logFile = record?.logFile;
          namedRun = await applyRunName({
            stateDir: options.stateDir,
            runId,
            prompt: options.prompt,
            ...(logFile ? { logFile, logTail: readLogTail(logFile) } : {}),
          });
        }
        // T10: SSE rename event — published only when sse is on
        if (namedRun && options.sse) {
          try {
            const hub = await getProcessHub(options);
            hub.publish({
              runId,
              agent: agent.name,
              ts: new Date().toISOString(),
              seq: 0,
              type: "rename",
              data: { name: namedRun.name },
            } as NotifyEvent);
          } catch {
            /* hub not available — skip */
          }
        }
        if (options.stream) {
          await recordResult(stateFilePath, agent.name, exitCode === 0);
          healthRecorded = true;
          if (exitCode !== 0) {
            throw new AgentError(`${agent.name} exited with code ${exitCode}`, exitCode);
          }
        }
        // Sandbox test: opt-in, blocking modes (stream / wait) only. After a
        // successful spawner exit, spawn a real `at -a <agent>` call in /tmp
        // to verify the agent is alive. Failure throws AgentError so the
        // existing retry-with-next-agent loop picks the next candidate.
        // Detached non-wait path: skipped (supervisor wiring is out of scope).
        if (options.sandbox && (options.stream || options.wait)) {
          await runSandboxTest(agent.name);
        }
        return 0;
      } catch (err) {
        if (!healthRecorded) {
          await recordResult(stateFilePath, agent.name, false);
        }
        const isLast = attempt === maxAttempts - 1;
        if (isLast || !(err instanceof AgentError)) throw err;
      }
    }

    // Unreachable, but satisfies strict return
    throw new AgentError("all retry attempts exhausted", 1);
  } finally {
    process.off("SIGTERM", cleanup);
    process.off("SIGINT", cleanup);
    if (options.stream) {
      killActiveChildren();
    }
  }
}

function buildDoneEvent(
  status: "done" | "failed",
  exitCode: number,
): Omit<NotifyEvent, "runId" | "agent" | "ts" | "seq"> {
  return { type: "done", data: { status, exitCode } };
}

/**
 * Detached run with `--wait`: block until the agent exits, honouring the
 * `--timeout` force-kill, then finalise the run record, agent health and the
 * `--callback` (with the real exit code). Returns the resolved exit code.
 */
async function awaitDetachedExit(result: LaunchResult, options: RunOptions): Promise<number> {
  const { child, runId, logFile, agent } = result;

  const agentExit = new Promise<{ code: number | null; signal: string | null }>((resolve) => {
    child.on("close", (code, signal) => resolve({ code, signal }));
    child.on("error", () => resolve({ code: 1, signal: null }));
  });

  let timeoutHandle: ReturnType<typeof setTimeout>;
  const timeoutP = new Promise<{ code: null; signal: "SIGKILL" }>((resolve) => {
    timeoutHandle = setTimeout(() => resolve({ code: null, signal: "SIGKILL" }), options.timeout);
  });

  const { code, signal } = await Promise.race([agentExit, timeoutP]);
  clearTimeout(timeoutHandle!);
  untrackChild(child.pid!);

  if (signal === "SIGKILL") {
    try {
      process.kill(-child.pid!, "SIGKILL");
    } catch {}
    try {
      appendFileSync(logFile, `[at] timeout: killed after ${options.timeout}ms\n`);
    } catch {}
    await updateRun(options.stateDir, runId, {
      status: "failed",
      finishedAt: new Date().toISOString(),
      exitCode: 1,
    });
    const sfp = getStateFilePath(options.stateDir);
    await recordResult(sfp, agent.name, false);
    throw new Error(`${agent.name} killed after ${options.timeout}ms timeout`);
  }

  const exitCode = code ?? 1;
  let status: "done" | "failed" = exitCode === 0 ? "done" : "failed";
  await updateRun(options.stateDir, runId, {
    status,
    finishedAt: new Date().toISOString(),
    exitCode,
  });
  const sfp = getStateFilePath(options.stateDir);
  await recordResult(sfp, agent.name, exitCode === 0);

  // Post-agent verify hook: see streamLogsAndWatch for the full rationale.
  if (options.verify?.trim()) {
    const verifyCmd = options.verify.trim();
    const verifyCwd = options.cwd ?? process.cwd();
    const { exitCode: verifyExit, output } = runVerify(verifyCmd, verifyCwd);
    if (verifyExit === 0) {
      appendVerifyLogLine(logFile, "ok", verifyCmd, 0);
    } else {
      status = "failed";
      await updateRun(options.stateDir, runId, { status });
      appendVerifyLogLine(logFile, "failed", verifyCmd, verifyExit, output);
      executeCallback(options.callback, {
        runId,
        agent: agent.name,
        tier: agent.tier,
        exitCode,
        logFile,
        prompt: options.prompt,
        status,
        name: options.runName ?? UNNAMED_PLACEHOLDER,
      });
      throw new AgentError(`verify failed (exit ${verifyExit}): ${verifyCmd}`, verifyExit);
    }
  }

  executeCallback(options.callback, {
    runId,
    agent: agent.name,
    tier: agent.tier,
    exitCode,
    logFile,
    prompt: options.prompt,
    status,
    name: options.runName ?? UNNAMED_PLACEHOLDER,
  });

  return exitCode;
}

export const defaultSpawner: Spawner = async (agent, options, providedRunId) => {
  if (!options.sse) {
    const result = await launchAgent(
      agent,
      options,
      options.runName
        ? { name: options.runName, ...(providedRunId ? { runId: providedRunId } : {}) }
        : providedRunId
          ? { runId: providedRunId }
          : undefined,
    );
    const { child, runId, logFile } = result;

    child.removeAllListeners("error");
    printReport(result, undefined, options.runName ?? UNNAMED_PLACEHOLDER);

    if (options.stream) {
      return streamLogsAndWatch(result, options);
    }

    if (options.wait) {
      // Detached + --wait: preserve the historical blocking semantics — await
      // the real exit so timeout, retry, agent-health tracking and a callback
      // with a truthful AT_EXIT_CODE all work.
      return awaitDetachedExit(result, options);
    }

    // Detached without --wait (default): print the run box (already done above),
    // hand finalisation over to a detached supervisor and return immediately so
    // the caller is never killed by an outer timeout (CI, 120s Bash tool, ...).
    child.on("error", (err) => {
      try {
        appendFileSync(logFile, `[at] error: ${err.message}\n`);
      } catch {}
    });
    // Detach the child from our event loop so the CLI can exit while the agent
    // keeps running, and stop tracking it (killActiveChildren must not reap it).
    untrackChild(child.pid!);
    child.unref();
    spawnRunWatch({
      pid: child.pid!,
      runId,
      stateDir: options.stateDir,
      agent: agent.name,
      tier: agent.tier,
      logFile,
      callback: options.callback,
      prompt: options.prompt,
      verify: options.verify,
      cwd: options.cwd,
      // This process is about to exit — the supervisor owns naming for
      // non-blocking detached runs (see the `naming` comment in `run()`).
      nameRun: !options.runName,
    });
    return 0;
  }

  // SSE path
  const hub = await getProcessHub(options);
  const runId = providedRunId ?? generateRunId();
  const eventFile = getEventFilePath(options.stateDir, runId);
  const sseUrl = `http://127.0.0.1:${hub.port}/events/${runId}`;
  const atBin = getAtBin();
  // Per-run host-channel helper. Cline v3 spawns its tool subprocesses inside
  // a long-running hub daemon whose env (AT_STATE_DIR, AT_RUN_ID, ...) was
  // captured when the hub first started, so a fresh spawn's env is ignored
  // and the LLM's bash calls land on a stale state dir / run id. The adapter
  // inlines the shim path into the prompt so the host channel is
  // deterministic regardless of the daemon's env.
  const hostChannelShim = writeHostChannelShim({
    cwd: options.cwd,
    atBin,
    stateDir: options.stateDir,
    runId,
  });
  const ctx = {
    runId,
    port: hub.port,
    eventFile,
    stateDir: options.stateDir,
    atBin,
    cwd: options.cwd,
    hostChannelShim,
  };
  const { env: adapterEnv, promptPrefix, promptSuffix, adapter } = setupNotify(agent.name, ctx);
  const extraEnv = {
    ...adapterEnv,
    AT_RUN_ID: runId,
    AT_SSE_URL: `http://127.0.0.1:${hub.port}`,
    AT_EVENT_FILE: eventFile,
    AT_BIN: atBin,
    AT_STATE_DIR: options.stateDir,
    AT_RUN_NAME: options.runName ?? UNNAMED_PLACEHOLDER,
  };

  // Build the prompt text with prefix and suffix. The prefix lands first so
  // cline's LLM sees the host-channel instructions before the user task
  // (it otherwise dives into the task and skims a trailing suffix).
  let promptText = options.prompt;
  if (promptPrefix) {
    promptText = `${promptPrefix}\n\n${promptText}`;
  }
  if (promptSuffix) {
    promptText = `${promptText}\n\n${promptSuffix}`;
  }

  // Compute argv: if adapter provides transformArgs, give it the full base
  // args (with prompt already appended) so structured flags can be inserted
  // before the prompt. Otherwise, append adapter.args() after the prompt.
  const baseArgs = applyNormkaFlag(agent, agent.buildArgs(promptText, options.model, options.cwd), promptText, {
    normka: options.normka,
  });
  const finalArgs = adapter.transformArgs
    ? adapter.transformArgs(ctx, baseArgs)
    : (() => {
        const a = adapter.args?.(ctx) ?? [];
        return a.length ? [...baseArgs, ...a] : baseArgs;
      })();

  const result = await launchAgent(agent, options, {
    runId,
    overrideArgs: finalArgs,
    // For stdin-mode agents, the suffix travels through extraPrompt so
    // launchAgent writes `prompt + promptSuffix` to the child's stdin.
    extraPrompt: promptSuffix,
    extraEnv,
    name: options.runName,
  });
  const { child, logFile } = result;
  child.removeAllListeners("error");

  hub.publish({
    runId,
    agent: agent.name,
    ts: new Date().toISOString(),
    seq: 0,
    type: "start",
    text: `started ${agent.name} (pid ${child.pid})`,
  });

  const tailer = tailLogFile(logFile, runId, agent.name, (e) => hub.publish(e), adapter);

  const agentExit = new Promise<{ code: number | null; signal: string | null }>((resolve) => {
    child.on("close", (code, signal) => resolve({ code, signal }));
    child.on("error", () => resolve({ code: 1, signal: null }));
  });

  printReport(result, sseUrl, options.runName ?? UNNAMED_PLACEHOLDER);

  if (options.stream) {
    try {
      const exitCode = await streamLogsAndWatch(result, options);
      hub.publish({
        ...buildDoneEvent("done", exitCode),
        runId,
        agent: agent.name,
        ts: new Date().toISOString(),
        seq: 0,
      } as NotifyEvent);
      tailer.stop();
      await closeProcessHub();
      return exitCode;
    } catch (err) {
      const exitCode = (err as AgentError).code ?? 1;
      hub.publish({
        ...buildDoneEvent("failed", exitCode),
        runId,
        agent: agent.name,
        ts: new Date().toISOString(),
        seq: 0,
      } as NotifyEvent);
      tailer.stop();
      await closeProcessHub();
      throw err;
    }
  }

  // Detached + SSE: block until child exits so hub stays alive
  child.on("error", (err) => {
    try {
      appendFileSync(logFile, `[at] error: ${err.message}\n`);
    } catch {}
    hub.publish({
      type: "error",
      text: err.message,
      runId,
      agent: agent.name,
      ts: new Date().toISOString(),
      seq: 0,
    } as NotifyEvent);
    updateRun(options.stateDir, runId, {
      status: "failed",
      finishedAt: new Date().toISOString(),
      exitCode: 1,
    }).catch(() => {});
    const sfp = getStateFilePath(options.stateDir);
    recordResult(sfp, agent.name, false).catch(() => {});
  });

  const { code } = await agentExit;
  const exitCode = code ?? 1;
  let status: "done" | "failed" = exitCode === 0 ? "done" : "failed";
  await updateRun(options.stateDir, runId, {
    status,
    finishedAt: new Date().toISOString(),
    exitCode,
  });
  const sfp = getStateFilePath(options.stateDir);
  await recordResult(sfp, agent.name, exitCode === 0);

  // Post-agent verify hook (see streamLogsAndWatch for the rationale).
  if (options.verify?.trim()) {
    const verifyCmd = options.verify.trim();
    const verifyCwd = options.cwd ?? process.cwd();
    const { exitCode: verifyExit, output } = runVerify(verifyCmd, verifyCwd);
    if (verifyExit === 0) {
      appendVerifyLogLine(logFile, "ok", verifyCmd, 0);
    } else {
      status = "failed";
      await updateRun(options.stateDir, runId, { status });
      appendVerifyLogLine(logFile, "failed", verifyCmd, verifyExit, output);
      hub.publish({
        ...buildDoneEvent(status, exitCode),
        runId,
        agent: agent.name,
        ts: new Date().toISOString(),
        seq: 0,
      } as NotifyEvent);
      tailer.stop();
      executeCallback(options.callback, {
        runId,
        agent: agent.name,
        tier: agent.tier,
        exitCode,
        logFile,
        prompt: options.prompt,
        status,
        name: options.runName ?? UNNAMED_PLACEHOLDER,
      });
      throw new AgentError(`verify failed (exit ${verifyExit}): ${verifyCmd}`, verifyExit);
    }
  }

  hub.publish({
    ...buildDoneEvent(status, exitCode),
    runId,
    agent: agent.name,
    ts: new Date().toISOString(),
    seq: 0,
  } as NotifyEvent);
  tailer.stop();

  executeCallback(options.callback, {
    runId,
    agent: agent.name,
    tier: agent.tier,
    exitCode,
    logFile,
    prompt: options.prompt,
    status,
    name: options.runName ?? UNNAMED_PLACEHOLDER,
  });

  await closeProcessHub();
  return exitCode;
};

function getEventFilePath(stateDir: string, runId: string): string {
  return path.join(stateDir, "events", `${runId}.jsonl`);
}

const COLORS = [
  "red",
  "blue",
  "green",
  "yellow",
  "purple",
  "orange",
  "pink",
  "black",
  "white",
  "gray",
  "cyan",
  "magenta",
  "lime",
  "teal",
  "indigo",
  "violet",
  "gold",
  "silver",
  "bronze",
  "crimson",
];

const ADJECTIVES = [
  "cheerful",
  "bright",
  "dark",
  "swift",
  "calm",
  "bold",
  "quiet",
  "loud",
  "sharp",
  "soft",
  "wild",
  "gentle",
  "fierce",
  "silent",
  "rapid",
  "slow",
  "heavy",
  "light",
  "strong",
  "weak",
];

const STELLAR_BODIES = [
  "jupiter",
  "mars",
  "venus",
  "saturn",
  "mercury",
  "neptune",
  "uranus",
  "earth",
  "pluto",
  "ceres",
  "halley",
  "encke",
  "tempel",
  "borrelly",
  "wild",
  "schwassmann",
  "kopff",
  "daniel",
  "brorsen",
  "finlay",
  "cygnus1",
  "sagra",
  "ton618",
  "m87",
  "andromeda",
  "sombrero",
  "whirlpool",
  "pinwheel",
  "cartwheel",
  "sunflower",
  "sirius",
  "canopus",
  "rigel",
  "vega",
  "arcturus",
  "altair",
  "aldebaran",
  "antares",
  "spica",
  "pollux",
];

function getRandomElement<T>(array: T[]): T {
  return array[Math.floor(Math.random() * array.length)];
}

function generateRandomString(length: number): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

function generateRunId(): string {
  const color = getRandomElement(COLORS);
  const adjective = getRandomElement(ADJECTIVES);
  const stellarBody = getRandomElement(STELLAR_BODIES);
  const randomSuffix = generateRandomString(5);

  return `${color}-${adjective}-${stellarBody}-${randomSuffix}`;
}
