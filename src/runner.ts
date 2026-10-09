import { spawn, spawnSync } from 'child_process';
import { mkdirSync, openSync, closeSync, writeSync, appendFileSync, existsSync } from 'fs';
import path from 'path';

import { AgentDef } from './agents/registry';
import { RunOptions } from './resolver';
import { pickAgent, getStateFile } from './scheduler';
import { filterHealthy, recordResult, isDeactivated, loadHealth } from './health';
import { addRun, updateRun } from './run-store';
import { getStateFilePath } from './state-dir';
import { setupNotify, startHub, tailLogFile, type Hub, type NotifyEvent } from './notify';
import { generateSessionName } from './namer';
import { spawnRunWatch } from './run-watch';

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
        process.kill(-child.pid, 'SIGKILL');
      } else {
        process.kill(child.pid, 'SIGKILL');
      }
    } catch {
      // ignore — process may already be dead
    }
  }
  activeChildren.length = 0;
}

export class AgentError extends Error {
  code: number;
  constructor(message: string, code: number) {
    super(message);
    this.code = code;
  }
}

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
  status: 'done' | 'failed';
  name: string;
}

export function executeCallback(command: string | undefined, context: CallbackContext): void {
  if (!command || !command.trim()) return;

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
  const result = spawnSync(cmd, [], { env, stdio: 'inherit', shell: true });
  if (result.status !== 0) {
    console.warn(`[at] callback exited with code ${result.status ?? 1}: ${cmd}`);
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
   * Session name forwarded to the child as `AT_RUN_NAME` and persisted on
   * the run record. Defaults to `'unnamed'` when the namer is disabled or
   * failed; the field is always populated so downstream columns stay stable.
   */
  name?: string;
}

export const UNNAMED_PLACEHOLDER = 'unnamed';

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
  if (/^[a-zA-Z0-9_\/\.\-]+$/.test(s)) return s;
  return `'${s.replace(/'/g, "'\\''")}'`;
}

export async function launchAgent(agent: AgentDef, options: RunOptions, extras?: LaunchExtras): Promise<LaunchResult> {
  const runId = extras?.runId ?? generateRunId();
  const promptText = options.prompt + (extras?.extraPrompt ?? '');
  const baseArgs = agent.buildArgs(promptText, options.model);
  let args: string[];
  if (extras?.overrideArgs) {
    args = extras.overrideArgs;
  } else if (extras?.extraArgs) {
    args = [...baseArgs, ...extras.extraArgs];
  } else {
    args = baseArgs;
  }
  const extraEnv = agent.buildEnv?.(options.model) ?? {};
  const env = { ...process.env, ...extraEnv, ...(options.env ?? {}), ...(extras?.extraEnv ?? {}) } as Record<string, string>;
  env.AT_RUN_NAME = extras?.name ?? UNNAMED_PLACEHOLDER;

  mkdirSync(options.logDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const logFile = path.join(options.logDir, `at-${timestamp}-${agent.name}.log`);
  const stdinData = agent.promptMode === 'stdin' ? promptText : undefined;

  const logFd = openSync(logFile, 'w');
  writeSync(logFd, `[at] runId: ${runId}\n`);

  const child = spawn(agent.bin(), args, {
    env,
    cwd: options.cwd,
    detached: true,
    stdio: stdinData ? ['pipe', logFd, logFd] : ['ignore', logFd, logFd],
  });

  if (child.pid === undefined) {
    writeSync(logFd, `[at] error: Failed to spawn ${agent.name}: no PID assigned\n`);
    closeSync(logFd);
    throw new Error(`Failed to spawn ${agent.name}: no PID assigned`);
  }

  closeSync(logFd);
  child.once('error', () => {});

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
    prompt: options.prompt.slice(0, 200),
    logFile,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    exitCode: null,
    status: 'running',
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
      hub.close().then(() => resolve(), () => resolve());
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
    child.on('close', (code, signal) => resolve({ code, signal }));
    child.on('error', () => resolve({ code: 1, signal: null }));
  });

  let timeoutHandle: ReturnType<typeof setTimeout>;
  const timeoutP = new Promise<{ code: null; signal: 'SIGKILL' }>((resolve) => {
    timeoutHandle = setTimeout(() => resolve({ code: null, signal: 'SIGKILL' }), timeoutMs);
  });

  // Use in-process log-streamer for real-time filtering.
  // Falls back to plain tail -f if --no-chop or the built streamer is missing.
  const logStreamerJs = path.join(__dirname, 'log-streamer.js');
  const useStreamer = !options.noChop && existsSync(logStreamerJs);

  const streamCmd = useStreamer ? 'node' : 'tail';
  const streamArgs = useStreamer
    ? [logStreamerJs, '--log', logFile, '--pid', String(child.pid!)]
    : ['-f', logFile];

  const streamChild = spawn(streamCmd, streamArgs, {
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
  });

  let streamPid: number | undefined;
  if (streamChild.pid !== undefined) {
    streamPid = streamChild.pid;
    trackChild(streamPid, false);
  }

  const ignoreEpipe = (err: Error) => {
    if ((err as NodeJS.ErrnoException).code !== 'EPIPE') {
      console.error(`[at] stdout/stderr error: ${err.message}`);
    }
  };
  process.stdout.on('error', ignoreEpipe);
  process.stderr.on('error', ignoreEpipe);

  streamChild.stdout?.pipe(process.stdout, { end: false });
  streamChild.stderr?.pipe(process.stderr, { end: false });

  streamChild.on('error', (err) => {
    console.error(`[at] log stream error (logs at ${logFile}): ${err.message}`);
  });

  const { code, signal } = await Promise.race([agentExit, timeoutP]);
  clearTimeout(timeoutHandle!);

  if (streamPid !== undefined) {
    try { streamChild.kill('SIGKILL'); } catch {}
    untrackChild(streamPid);
  }
  untrackChild(child.pid!);

  process.stdout.off('error', ignoreEpipe);
  process.stderr.off('error', ignoreEpipe);

  if (signal === 'SIGKILL') {
    try { process.kill(-child.pid!, 'SIGKILL'); } catch {}
    try { appendFileSync(logFile, `[at] timeout: killed after ${timeoutMs}ms\n`); } catch {}
    await updateRun(options.stateDir, runId, {
      status: 'failed',
      finishedAt: new Date().toISOString(),
      exitCode: 1,
    });
    throw new Error(`${agent.name} killed after ${timeoutMs}ms timeout`);
  }

  const exitCode = code ?? 1;
  const status = exitCode === 0 ? 'done' : 'failed';
  await updateRun(options.stateDir, runId, {
    status,
    finishedAt: new Date().toISOString(),
    exitCode,
  });

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

export async function run(
  options: RunOptions,
  agents: AgentDef[],
  spawner: Spawner = defaultSpawner,
): Promise<number> {

  const cleanup = () => {
    killActiveChildren();
    process.exit(1);
  };
  process.once('SIGTERM', cleanup);
  process.once('SIGINT', cleanup);

  try {
    // Fire-and-forget namer (T09): start the orchestrator now so it can run
    // in parallel with agent selection + spawn. The child gets `'unnamed'`
    // as AT_RUN_NAME during launch; the real name lands later via updateRun
    // when the orchestrator resolves.
    const runId = generateRunId();
    const namePromise: Promise<{ name: string; provider: string | null } | null> =
      options.namer && !options.runName
        ? generateSessionName(options.prompt, options.stateDir).catch(() => null)
        : Promise.resolve(null);

    const stateFilePath = getStateFilePath(options.stateDir);
    const healthState = loadHealth(stateFilePath);
    let candidates: AgentDef[];

    if (options.agent !== 'auto') {
      if (isDeactivated(stateFilePath, options.agent, healthState)) {
        throw new Error(
          `Agent "${options.agent}" is deactivated. Enable it first with: at enable ${options.agent}`,
        );
      }
      const named = agents.find((a) => a.name === options.agent);
      if (!named) throw new Error(`Unknown agent: ${options.agent}`);
      candidates = [named];
    } else {
      const tierAgents = agents.filter((a) => a.tier === options.tier);
      if (tierAgents.length === 0) throw new Error(`No agents defined for tier ${options.tier}`);
      const enabled = tierAgents.filter((a) => !isDeactivated(stateFilePath, a.name, healthState));
      if (enabled.length === 0) {
        throw new Error(`All tier-${options.tier} agents are deactivated`);
      }
      const healthy = await filterHealthy(stateFilePath, enabled, healthState);
      if (healthy.length === 0) {
        console.warn(`[at] all tier-${options.tier} agents are temporarily disabled, using full enabled pool`);
        candidates = enabled;
      } else {
        candidates = healthy;
      }
    }

    const isNamed = options.agent !== 'auto';
    const stateFile = getStateFile(options.stateDir);
    const maxAttempts = isNamed ? 1 : 1 + Math.min(options.retries, candidates.length - 1);
    let agent = isNamed ? candidates[0] : await pickAgent(candidates, stateFile, `tier-${options.tier}`);

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (attempt > 0) {
        agent = await pickAgent(candidates, stateFile, `tier-${options.tier}`);
        console.warn('[at] retrying with next agent...');
      }

      let healthRecorded = false;
      try {
        const exitCode = await spawner(agent, options, runId);
        // Wire namer result to run-store now that runId is known (fire-and-forget)
        if (options.namer && !options.runName) {
          namePromise.then(async (result) => {
            if (!result || result.provider === null) return; // fallback, no point updating
            void updateRun(options.stateDir, runId, { name: result.name }).catch(() => {});
            // T10: SSE rename event — published only when sse is on
            if (options.sse) {
              try {
                const hub = await getProcessHub(options);
                hub.publish({
                  runId,
                  agent: agent.name,
                  ts: new Date().toISOString(),
                  seq: 0,
                  type: 'rename',
                  data: { name: result.name },
                } as NotifyEvent);
              } catch { /* hub not available — skip */ }
            }
          }).catch(() => {});
        }
        if (options.stream) {
          await recordResult(stateFilePath, agent.name, exitCode === 0);
          healthRecorded = true;
          if (exitCode !== 0) {
            throw new AgentError(`${agent.name} exited with code ${exitCode}`, exitCode);
          }
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
    throw new AgentError('all retry attempts exhausted', 1);
  } finally {
    process.off('SIGTERM', cleanup);
    process.off('SIGINT', cleanup);
    if (options.stream) {
      killActiveChildren();
    }
  }
}

function buildDoneEvent(status: 'done' | 'failed', exitCode: number): Omit<NotifyEvent, 'runId' | 'agent' | 'ts' | 'seq'> {
  return { type: 'done', data: { status, exitCode } };
}

/**
 * Detached run with `--wait`: block until the agent exits, honouring the
 * `--timeout` force-kill, then finalise the run record, agent health and the
 * `--callback` (with the real exit code). Returns the resolved exit code.
 */
async function awaitDetachedExit(result: LaunchResult, options: RunOptions): Promise<number> {
  const { child, runId, logFile, agent } = result;

  const agentExit = new Promise<{ code: number | null; signal: string | null }>((resolve) => {
    child.on('close', (code, signal) => resolve({ code, signal }));
    child.on('error', () => resolve({ code: 1, signal: null }));
  });

  let timeoutHandle: ReturnType<typeof setTimeout>;
  const timeoutP = new Promise<{ code: null; signal: 'SIGKILL' }>((resolve) => {
    timeoutHandle = setTimeout(() => resolve({ code: null, signal: 'SIGKILL' }), options.timeout);
  });

  const { code, signal } = await Promise.race([agentExit, timeoutP]);
  clearTimeout(timeoutHandle!);
  untrackChild(child.pid!);

  if (signal === 'SIGKILL') {
    try { process.kill(-child.pid!, 'SIGKILL'); } catch {}
    try { appendFileSync(logFile, `[at] timeout: killed after ${options.timeout}ms\n`); } catch {}
    await updateRun(options.stateDir, runId, {
      status: 'failed',
      finishedAt: new Date().toISOString(),
      exitCode: 1,
    });
    const sfp = getStateFilePath(options.stateDir);
    await recordResult(sfp, agent.name, false);
    throw new Error(`${agent.name} killed after ${options.timeout}ms timeout`);
  }

  const exitCode = code ?? 1;
  const status = exitCode === 0 ? 'done' : 'failed';
  await updateRun(options.stateDir, runId, {
    status,
    finishedAt: new Date().toISOString(),
    exitCode,
  });
  const sfp = getStateFilePath(options.stateDir);
  await recordResult(sfp, agent.name, exitCode === 0);

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
        : providedRunId ? { runId: providedRunId } : undefined,
    );
    const { child, runId, logFile } = result;

    child.removeAllListeners('error');
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
    child.on('error', (err) => {
      try { appendFileSync(logFile, `[at] error: ${err.message}\n`); } catch {}
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
    });
    return 0;
  }

  // SSE path
  const hub = await getProcessHub(options);
  const runId = providedRunId ?? generateRunId();
  const eventFile = getEventFilePath(options.stateDir, runId);
  const sseUrl = `http://127.0.0.1:${hub.port}/events/${runId}`;
  const ctx = { runId, port: hub.port, eventFile };
  const { env: adapterEnv, promptSuffix, adapter } = setupNotify(agent.name, ctx);
  const extraEnv = {
    ...adapterEnv,
    AT_RUN_ID: runId,
    AT_SSE_URL: `http://127.0.0.1:${hub.port}`,
    AT_EVENT_FILE: eventFile,
    AT_BIN: getAtBin(),
    AT_STATE_DIR: options.stateDir,
    AT_RUN_NAME: options.runName ?? UNNAMED_PLACEHOLDER,
  };

  // Compute argv: if adapter provides transformArgs, give it the full base
  // args (with prompt already appended) so structured flags can be inserted
  // before the prompt. Otherwise, append adapter.args() after the prompt.
  const promptText = options.prompt + promptSuffix;
  const baseArgs = agent.buildArgs(promptText, options.model);
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
  child.removeAllListeners('error');

  hub.publish({
    runId,
    agent: agent.name,
    ts: new Date().toISOString(),
    seq: 0,
    type: 'start',
    text: `started ${agent.name} (pid ${child.pid})`,
  });

  const tailer = tailLogFile(logFile, runId, agent.name, (e) => hub.publish(e), adapter);

  const agentExit = new Promise<{ code: number | null; signal: string | null }>((resolve) => {
    child.on('close', (code, signal) => resolve({ code, signal }));
    child.on('error', () => resolve({ code: 1, signal: null }));
  });

  printReport(result, sseUrl, options.runName ?? UNNAMED_PLACEHOLDER);

  if (options.stream) {
    try {
      const exitCode = await streamLogsAndWatch(result, options);
      hub.publish({ ...buildDoneEvent('done', exitCode), runId, agent: agent.name, ts: new Date().toISOString(), seq: 0 } as NotifyEvent);
      tailer.stop();
      await closeProcessHub();
      return exitCode;
    } catch (err) {
      const exitCode = (err as AgentError).code ?? 1;
      hub.publish({ ...buildDoneEvent('failed', exitCode), runId, agent: agent.name, ts: new Date().toISOString(), seq: 0 } as NotifyEvent);
      tailer.stop();
      await closeProcessHub();
      throw err;
    }
  }

  // Detached + SSE: block until child exits so hub stays alive
  child.on('error', (err) => {
    try { appendFileSync(logFile, `[at] error: ${err.message}\n`); } catch {}
    hub.publish({ type: 'error', text: err.message, runId, agent: agent.name, ts: new Date().toISOString(), seq: 0 } as NotifyEvent);
    updateRun(options.stateDir, runId, {
      status: 'failed',
      finishedAt: new Date().toISOString(),
      exitCode: 1,
    }).catch(() => {});
    const sfp = getStateFilePath(options.stateDir);
    recordResult(sfp, agent.name, false).catch(() => {});
  });

  const { code } = await agentExit;
  const exitCode = code ?? 1;
  const status = exitCode === 0 ? 'done' : 'failed';
  await updateRun(options.stateDir, runId, {
    status,
    finishedAt: new Date().toISOString(),
    exitCode,
  });
  const sfp = getStateFilePath(options.stateDir);
  await recordResult(sfp, agent.name, exitCode === 0);

  hub.publish({ ...buildDoneEvent(status, exitCode), runId, agent: agent.name, ts: new Date().toISOString(), seq: 0 } as NotifyEvent);
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
  return path.join(stateDir, 'events', `${runId}.jsonl`);
}

const COLORS = [
  'red', 'blue', 'green', 'yellow', 'purple', 'orange', 'pink', 'black', 'white', 'gray',
  'cyan', 'magenta', 'lime', 'teal', 'indigo', 'violet', 'gold', 'silver', 'bronze', 'crimson'
];

const ADJECTIVES = [
  'cheerful', 'bright', 'dark', 'swift', 'calm', 'bold', 'quiet', 'loud', 'sharp', 'soft',
  'wild', 'gentle', 'fierce', 'silent', 'rapid', 'slow', 'heavy', 'light', 'strong', 'weak'
];

const STELLAR_BODIES = [
  'jupiter', 'mars', 'venus', 'saturn', 'mercury', 'neptune', 'uranus', 'earth', 'pluto', 'ceres',
  'halley', 'encke', 'tempel', 'borrelly', 'wild', 'schwassmann', 'kopff', 'daniel', 'brorsen', 'finlay',
  'cygnus1', 'sagra', 'ton618', 'm87', 'andromeda', 'sombrero', 'whirlpool', 'pinwheel', 'cartwheel', 'sunflower',
  'sirius', 'canopus', 'rigel', 'vega', 'arcturus', 'altair', 'aldebaran', 'antares', 'spica', 'pollux'
];

function getRandomElement<T>(array: T[]): T {
  return array[Math.floor(Math.random() * array.length)];
}

function generateRandomString(length: number): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
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
