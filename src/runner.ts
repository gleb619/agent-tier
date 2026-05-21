import { spawn, execSync } from 'child_process';
import { mkdirSync, openSync, closeSync, createWriteStream, writeSync, appendFileSync } from 'fs';
import path from 'path';

function generateRunId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}
import { AgentDef } from './agents/registry';
import { RunOptions } from './resolver';
import { pickAgent, getStateFile } from './scheduler';
import { ORCHESTRATORS } from './orchestrators/registry';

function chopAvailable(): boolean {
  try {
    execSync('chop --version', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

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

export async function run(
  options: RunOptions,
  agents: AgentDef[],
  spawner: Spawner = defaultSpawner,
): Promise<number> {
  // Clear any leaked state from previous calls
  activeChildren.length = 0;

  const cleanup = () => {
    killActiveChildren();
    process.exit(1);
  };
  process.once('SIGTERM', cleanup);
  process.once('SIGINT', cleanup);

  try {
    const candidatePool = options.orchestrate ? ORCHESTRATORS : agents;
    const statePrefix = options.orchestrate ? 'at-orch' : 'at';
    let candidates: AgentDef[];

    if (options.agent !== 'auto') {
      const named = candidatePool.find((a) => a.name === options.agent);
      if (!named) throw new Error(`Unknown agent: ${options.agent}`);
      candidates = [named];
    } else {
      candidates = candidatePool.filter((a) => a.tier === options.tier);
      if (candidates.length === 0) throw new Error(`No agents defined for tier ${options.tier}`);
    }

    const isNamed = options.agent !== 'auto';
    //const maxAttempts = isNamed ? 1 : Math.min(options.retries + 1, candidates.length);
    const maxAttempts = 1; //It leads to bugs and agents children ghosts(staled processes)
    const stateFile = getStateFile(options.tier, options.globalState, statePrefix);
    let lastExitCode = 1;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (attempt > 0) {
        killActiveChildren();
      }

      const agent = isNamed ? candidates[0] : pickAgent(candidates, stateFile);
      const hasMore = attempt < maxAttempts - 1;

      try {
        const exitCode = await spawner(agent, options);
        if (exitCode === 0) return 0;
        lastExitCode = exitCode;
        lastError = new AgentError(`${agent.name} exited with code ${exitCode}`, exitCode);
        console.error(`[at] ${agent.name} failed (exit ${exitCode})${hasMore ? ', retrying...' : ''}`);
      } catch (err) {
        lastError = err as Error;
        console.error(`[at] ${agent.name} error: ${(err as Error).message}${hasMore ? ', retrying...' : ''}`);
      }
    }

    if (lastError) throw lastError;
    throw new AgentError('All attempts failed', lastExitCode);
  } finally {
    process.off('SIGTERM', cleanup);
    process.off('SIGINT', cleanup);
    killActiveChildren();
  }
}

export const defaultSpawner: Spawner = (agent, options) => {
  const bin = agent.bin();
  const args = agent.buildArgs(options.prompt, options.model);
  const extraEnv = agent.buildEnv?.(options.model) ?? {};
  const env = { ...process.env, ...extraEnv, ...(options.env ?? {}) } as Record<string, string>;

  return options.stream
    ? spawnStream(bin, args, env, options, agent, options.noChop)
    : spawnDetached(bin, args, env, options, agent);
};

function spawnStream(
  bin: string,
  args: string[],
  env: Record<string, string>,
  options: RunOptions,
  agent: AgentDef,
  noChop?: boolean,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const useChop = !noChop && chopAvailable();
    const [cmd, cmdArgs] = useChop
      ? ['chop', [bin, ...args]]
      : [bin, args];

    mkdirSync(options.logDir, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const logFile = path.join(options.logDir, `at-${timestamp}-${agent.name}.log`);
    const stdinData = agent.promptMode === 'stdin' ? options.prompt : undefined;
    const logStream = createWriteStream(logFile);
    const runId = generateRunId();
    logStream.write(`[at] runId: ${runId}\n`);

    const child = spawn(cmd, cmdArgs, {
      env,
      cwd: options.cwd,
      detached: true,
      stdio: stdinData ? ['pipe', 'pipe', 'pipe'] : ['ignore', 'pipe', 'pipe'],
    });

    // Prevent unhandled 'error' event if spawn fails before the real handler is attached
    const swallowSpawnError = () => {};
    child.once('error', swallowSpawnError);

    const ignoreEpipe = (err: Error) => {
      if ((err as NodeJS.ErrnoException).code === 'EPIPE') {
        // Consumer closed the pipe (e.g., `| head`) — harmless
      } else {
        console.error(`[at] stdout/stderr error: ${err.message}`);
      }
    };
    process.stdout.on('error', ignoreEpipe);
    process.stderr.on('error', ignoreEpipe);

    logStream.on('error', (err) => {
      console.error(`[at] log stream error: ${err.message}`);
    });

    child.stdout!.pipe(process.stdout, { end: false });
    child.stdout!.pipe(logStream, { end: false });
    child.stderr!.pipe(process.stderr, { end: false });
    child.stderr!.pipe(logStream, { end: false });

    if (stdinData && child.stdin) {
      child.stdin.write(stdinData);
      child.stdin.end();
    }

    if (child.pid === undefined) {
      logStream.write('[at] error: Failed to spawn process: no PID assigned\n');
      process.stdout.off('error', ignoreEpipe);
      process.stderr.off('error', ignoreEpipe);
      logStream.end(() => {
        reject(new Error('Failed to spawn process: no PID assigned'));
      });
      return;
    }

    trackChild(child.pid, true);
    console.log(`[at] started ${agent.name} (pid ${child.pid}, runId ${runId}) — logs: ${logFile}`);

    const timeoutMs = options.timeout;
    const timeout = setTimeout(() => {
      const msg = `[at] timeout: killing process after ${timeoutMs}ms\n`;
      console.error(msg.trim());
      logStream.write(msg);
      try {
        process.kill(-child.pid!, 'SIGKILL');
      } catch {
        // ignore
      }
    }, timeoutMs);

    const cleanupStream = () => {
      clearTimeout(timeout);
      untrackChild(child.pid!);
      process.stdout.off('error', ignoreEpipe);
      process.stderr.off('error', ignoreEpipe);
      child.removeAllListeners('error');
    };

    child.off('error', swallowSpawnError);
    child.on('error', (err) => {
      cleanupStream();
      logStream.write(`[at] error: ${err.message}\n`);
      logStream.end(() => {
        reject(err);
      });
    });
    child.on('close', (code, signal) => {
      cleanupStream();
      logStream.end(() => {
        if (signal === 'SIGKILL') {
          reject(new Error(`process killed after ${timeoutMs}ms timeout`));
        } else {
          resolve(code ?? 1);
        }
      });
    });
  });
}

function spawnDetached(
  bin: string,
  args: string[],
  env: Record<string, string>,
  options: RunOptions,
  agent: AgentDef,
): Promise<number> {
  return new Promise((resolve, reject) => {
    mkdirSync(options.logDir, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const logFile = path.join(options.logDir, `at-${timestamp}-${agent.name}.log`);
    const stdinData = agent.promptMode === 'stdin' ? options.prompt : undefined;
    const runId = generateRunId();

    const logFd = openSync(logFile, 'w');
    writeSync(logFd, `[at] runId: ${runId}\n`);
    const child = spawn(bin, args, {
      env,
      cwd: options.cwd,
      detached: true,
      stdio: stdinData ? ['pipe', logFd, logFd] : ['ignore', logFd, logFd],
    });

    // Prevent unhandled 'error' event if spawn fails before the real handler is attached
    const swallowSpawnError = () => {};
    child.once('error', swallowSpawnError);

    if (child.pid === undefined) {
      writeSync(logFd, `[at] error: Failed to spawn ${agent.name}: no PID assigned\n`);
      closeSync(logFd);
      reject(new Error(`Failed to spawn ${agent.name}: no PID assigned`));
      return;
    }

    closeSync(logFd);

    if (stdinData && child.stdin) {
      child.stdin.write(stdinData);
      child.stdin.end();
    }

    trackChild(child.pid, true);

    const timeoutMs = options.timeout;
    const timeout = setTimeout(() => {
      const msg = `[at] timeout: killing ${agent.name} (pid ${child.pid}) after ${timeoutMs}ms\n`;
      console.error(msg.trim());
      try {
        appendFileSync(logFile, msg);
      } catch {
        // ignore
      }
      try {
        process.kill(-child.pid!, 'SIGKILL');
      } catch {
        // ignore
      }
    }, timeoutMs);

    child.off('error', swallowSpawnError);
    child.on('error', (err) => {
      clearTimeout(timeout);
      untrackChild(child.pid!);
      try {
        appendFileSync(logFile, `[at] error: ${err.message}\n`);
      } catch {
        // ignore
      }
      reject(err);
    });
    child.on('close', (code, signal) => {
      clearTimeout(timeout);
      untrackChild(child.pid!);
      if (signal === 'SIGKILL') {
        reject(new Error(`${agent.name} killed after ${timeoutMs}ms timeout`));
      } else {
        resolve(code ?? 1);
      }
    });

    console.log(`[at] started ${agent.name} (pid ${child.pid}, runId ${runId}) — logs: ${logFile}`);
  });
}
