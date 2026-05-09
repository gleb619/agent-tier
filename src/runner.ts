import { spawn } from 'child_process';
import { mkdirSync, openSync, closeSync } from 'fs';
import path from 'path';
import { AgentDef } from './agents/registry';
import { RunOptions } from './resolver';
import { pickAgent, getStateFile } from './scheduler';
import { ORCHESTRATORS } from './orchestrators/registry';

export type Spawner = (agent: AgentDef, options: RunOptions) => Promise<number>;

export async function run(
  options: RunOptions,
  agents: AgentDef[],
  spawner: Spawner = defaultSpawner,
): Promise<void> {
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
  const maxAttempts = isNamed ? 1 : Math.min(options.retries + 1, candidates.length);
  const stateFile = getStateFile(options.tier, options.globalState, statePrefix);
  let lastError: Error = new Error('All attempts failed');

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const agent = isNamed ? candidates[0] : pickAgent(candidates, stateFile);
    const hasMore = attempt < maxAttempts - 1;

    try {
      const exitCode = await spawner(agent, options);
      if (exitCode === 0) return;
      lastError = new Error(`${agent.name} exited with code ${exitCode}`);
      console.error(`[at] ${agent.name} failed (exit ${exitCode})${hasMore ? ', retrying...' : ''}`);
    } catch (err) {
      lastError = err as Error;
      console.error(`[at] ${agent.name} error: ${(err as Error).message}${hasMore ? ', retrying...' : ''}`);
    }
  }

  throw lastError;
}

export const defaultSpawner: Spawner = (agent, options) => {
  const bin = agent.bin();
  const args = agent.buildArgs(options.prompt, options.model);
  const extraEnv = agent.buildEnv?.(options.model) ?? {};
  const env = { ...process.env, ...extraEnv, ...(options.env ?? {}) } as Record<string, string>;

  return options.stream
    ? spawnStream(bin, args, env, options.cwd, agent.promptMode === 'stdin' ? options.prompt : undefined)
    : spawnDetached(bin, args, env, options, agent);
};

function spawnStream(
  bin: string,
  args: string[],
  env: Record<string, string>,
  cwd: string | undefined,
  stdinData?: string,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      env,
      cwd,
      stdio: stdinData ? ['pipe', 'inherit', 'inherit'] : 'inherit',
    });

    if (stdinData && child.stdin) {
      child.stdin.write(stdinData);
      child.stdin.end();
    }

    child.on('error', reject);
    child.on('close', (code) => resolve(code ?? 1));
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

    const logFd = openSync(logFile, 'w');
    const child = spawn(bin, args, {
      env,
      cwd: options.cwd,
      detached: true,
      stdio: stdinData ? ['pipe', logFd, logFd] : ['ignore', logFd, logFd],
    });
    closeSync(logFd);

    if (stdinData && child.stdin) {
      child.stdin.write(stdinData);
      child.stdin.end();
    }

    if (child.pid === undefined) {
      reject(new Error(`Failed to spawn ${agent.name}: no PID assigned`));
      return;
    }

    console.log(`[at] started ${agent.name} (pid ${child.pid}) — logs: ${logFile}`);
    child.unref();
    resolve(0);
  });
}
