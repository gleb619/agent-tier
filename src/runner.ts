import { spawn, execSync } from 'child_process';
import { mkdirSync, openSync, closeSync, writeSync, appendFileSync, existsSync } from 'fs';
import path from 'path';

import { AgentDef } from './agents/registry';
import { RunOptions } from './resolver';
import { pickAgent, getStateFile } from './scheduler';
import { filterHealthy, recordResult, isDeactivated } from './health';
import { addRun, updateRun } from './run-store';
import { getStateFilePath } from './state-dir';

interface TrackedChild {
  pid: number;
  detached: boolean;
}

const activeChildren: TrackedChild[] = [];

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

export type Spawner = (agent: AgentDef, options: RunOptions) => Promise<number>;

interface LaunchResult {
  child: ReturnType<typeof spawn>;
  runId: string;
  logFile: string;
  agent: AgentDef;
}

function launchAgent(agent: AgentDef, options: RunOptions): LaunchResult {
  const bin = agent.bin();
  const args = agent.buildArgs(options.prompt, options.model);
  const extraEnv = agent.buildEnv?.(options.model) ?? {};
  const env = { ...process.env, ...extraEnv, ...(options.env ?? {}) } as Record<string, string>;

  mkdirSync(options.logDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const logFile = path.join(options.logDir, `at-${timestamp}-${agent.name}.log`);
  const runId = generateRunId();
  const stdinData = agent.promptMode === 'stdin' ? options.prompt : undefined;

  const logFd = openSync(logFile, 'w');
  writeSync(logFd, `[at] runId: ${runId}\n`);

  const child = spawn(bin, args, {
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
  addRun(options.stateDir, {
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
  });

  return { child, runId, logFile, agent };
}

function printReport(result: LaunchResult): void {
  console.log(`[at] ┌──────────────────────────────────`);
  console.log(`[at] │ Run ID:  ${result.runId}`);
  console.log(`[at] │ Agent:   ${result.agent.name} (tier ${result.agent.tier})`);
  console.log(`[at] │ PID:     ${result.child.pid}`);
  console.log(`[at] │ Log:     ${result.logFile}`);
  console.log(`[at] │ Status:  running`);
  console.log(`[at] └──────────────────────────────────`);
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
    updateRun(options.stateDir, runId, {
      status: 'failed',
      finishedAt: new Date().toISOString(),
      exitCode: 1,
    });
    throw new Error(`${agent.name} killed after ${timeoutMs}ms timeout`);
  }

  const exitCode = code ?? 1;
  updateRun(options.stateDir, runId, {
    status: exitCode === 0 ? 'done' : 'failed',
    finishedAt: new Date().toISOString(),
    exitCode,
  });

  return exitCode;
}

export async function run(
  options: RunOptions,
  agents: AgentDef[],
  spawner: Spawner = defaultSpawner,
): Promise<number> {
  activeChildren.length = 0;

  const cleanup = () => {
    killActiveChildren();
    process.exit(1);
  };
  process.once('SIGTERM', cleanup);
  process.once('SIGINT', cleanup);

  try {
    const candidatePool = agents;
    const stateFilePath = getStateFilePath(options.stateDir);
    let candidates: AgentDef[];

    if (options.agent !== 'auto') {
      if (isDeactivated(stateFilePath, options.agent)) {
        throw new Error(
          `Agent "${options.agent}" is deactivated. Enable it first with: at enable ${options.agent}`,
        );
      }
      const named = candidatePool.find((a) => a.name === options.agent);
      if (!named) throw new Error(`Unknown agent: ${options.agent}`);
      candidates = [named];
    } else {
      const tierAgents = candidatePool.filter((a) => a.tier === options.tier);
      if (tierAgents.length === 0) throw new Error(`No agents defined for tier ${options.tier}`);
      const enabled = tierAgents.filter((a) => !isDeactivated(stateFilePath, a.name));
      if (enabled.length === 0) {
        throw new Error(`All tier-${options.tier} agents are deactivated`);
      }
      const healthy = filterHealthy(stateFilePath, enabled);
      if (healthy.length === 0) {
        console.warn(`[at] all tier-${options.tier} agents are temporarily disabled, using full enabled pool`);
        candidates = enabled;
      } else {
        candidates = healthy;
      }
    }

    const isNamed = options.agent !== 'auto';
    const stateFile = getStateFile(options.tier, options.stateDir);
    const agent = isNamed ? candidates[0] : pickAgent(candidates, stateFile);

    try {
      const exitCode = await spawner(agent, options);
      if (options.stream) {
        recordResult(stateFilePath, agent.name, exitCode === 0);
        if (exitCode !== 0) {
          throw new AgentError(`${agent.name} exited with code ${exitCode}`, exitCode);
        }
      }
      return 0;
    } catch (err) {
      recordResult(stateFilePath, agent.name, false);
      if (err instanceof AgentError) throw err;
      throw err;
    }
  } finally {
    process.off('SIGTERM', cleanup);
    process.off('SIGINT', cleanup);
    if (options.stream) {
      killActiveChildren();
    }
  }
}

export const defaultSpawner: Spawner = (agent, options) => {
  const result = launchAgent(agent, options);
  const { child, runId, logFile } = result;

  child.removeAllListeners('error');
  printReport(result);

  if (options.stream) {
    return streamLogsAndWatch(result, options);
  } else {
    child.on('error', (err) => {
      try { appendFileSync(logFile, `[at] error: ${err.message}\n`); } catch {}
      updateRun(options.stateDir, runId, {
        status: 'failed',
        finishedAt: new Date().toISOString(),
        exitCode: 1,
      });
    });
    child.on('close', (code) => {
      const exitCode = code ?? 1;
      updateRun(options.stateDir, runId, {
        status: exitCode === 0 ? 'done' : 'failed',
        finishedAt: new Date().toISOString(),
        exitCode,
      });
    });
    return Promise.resolve(0);
  }
};

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
  'cygnusx1', 'sagra', 'ton618', 'm87', 'andromeda', 'sombrero', 'whirlpool', 'pinwheel', 'cartwheel', 'sunflower',
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
