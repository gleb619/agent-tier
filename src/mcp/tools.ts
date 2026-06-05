import { Tool, CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { appendFileSync, readFileSync } from 'fs';

import { AGENTS, AgentDef } from '../agents/registry';
import { loadGenericAgents } from '../agents/generic-loader';
import { loadConfig, applyTierOverrides } from '../config';
import { resolveFromArgs } from '../resolver';
import { launchAgent, Spawner, run } from '../runner';
import { loadHealth, isDeactivated, setDeactivated, isHealthy } from '../health';
import { loadRuns, detectStuck, updateRun } from '../run-store';
import { getStateFilePath } from '../state-dir';

export const AT_TOOLS: Tool[] = [
  {
    name: 'run_prompt',
    description: 'Route a coding prompt to an AI agent via at tier scheduling',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'The coding prompt to execute' },
        tier: { type: 'number', enum: [1, 2, 3, 4], description: '1=architect, 2=dev (default), 3=experimental, 4=mock' },
        agent: { type: 'string', description: 'Specific agent name, or omit for auto routing' },
        model: { type: 'string', description: 'Model name to pass to agent' },
        retries: { type: 'number', description: 'Max extra retry attempts (default: 0)' },
        timeout: { type: 'number', description: 'Timeout ms (default: 3600000)' },
      },
      required: ['prompt'],
    },
  },
  {
    name: 'list_agents',
    description: 'List available AI agents with tier and health status',
    inputSchema: {
      type: 'object',
      properties: {
        tier: { type: 'number', enum: [1, 2, 3, 4] },
      },
    },
  },
  {
    name: 'get_status',
    description: 'Get recent run records from at run store',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Max runs to return (default: 10)' },
      },
    },
  },
  {
    name: 'disable_agent',
    description: 'Disable an agent to prevent scheduling',
    inputSchema: {
      type: 'object',
      properties: {
        agent: { type: 'string' },
      },
      required: ['agent'],
    },
  },
  {
    name: 'enable_agent',
    description: 'Re-enable a previously disabled agent',
    inputSchema: {
      type: 'object',
      properties: {
        agent: { type: 'string' },
      },
      required: ['agent'],
    },
  },
];

function makeResult(text: string, isError = false): CallToolResult {
  return {
    content: [{ type: 'text', text }],
    isError,
  } as CallToolResult;
}

function makeJsonResult(result: unknown, isError = false): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    isError,
  } as CallToolResult;
}

export async function handleToolCall(
  name: string,
  args: Record<string, unknown>,
  stateDir: string,
): Promise<CallToolResult> {
  try {
    switch (name) {
      case 'run_prompt':
        return await handleRunPrompt(args, stateDir);
      case 'list_agents':
        return await handleListAgents(args, stateDir);
      case 'get_status':
        return await handleGetStatus(args, stateDir);
      case 'disable_agent':
        return await handleDisableAgent(args, stateDir);
      case 'enable_agent':
        return await handleEnableAgent(args, stateDir);
      default:
        return makeResult(`Unknown tool: ${name}`, true);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return makeResult(`Error: ${message}`, true);
  }
}

async function handleRunPrompt(args: Record<string, unknown>, stateDir: string): Promise<CallToolResult> {
  const effectiveAgents = applyTierOverrides([...AGENTS, ...loadGenericAgents()], loadConfig());

  const runOptions = resolveFromArgs({
    prompt: args.prompt as string,
    tier: args.tier as number | undefined,
    agent: args.agent as string | undefined,
    model: args.model as string | undefined,
    retries: args.retries as number | undefined,
    timeout: args.timeout as number | undefined,
    stream: true,
    stateDir,
    logDir: '/tmp/at-mcp-logs',
    noChop: true,
  });

  let usedAgent: AgentDef | undefined;
  let capturedLogFile = '';

  const customSpawner: Spawner = async (agentDef, options) => {
    usedAgent = agentDef;
    const result = await launchAgent(agentDef, options);
    const { child, runId, logFile } = result;
    capturedLogFile = logFile;
    const timeoutMs = options.timeout;

    const agentExit = new Promise<{ code: number | null; signal: string | null }>((resolve) => {
      child.on('close', (code, signal) => resolve({ code, signal }));
      child.on('error', () => resolve({ code: 1, signal: null }));
    });

    let timeoutHandle: ReturnType<typeof setTimeout>;
    const timeoutP = new Promise<{ code: null; signal: 'SIGKILL' }>((resolve) => {
      timeoutHandle = setTimeout(() => resolve({ code: null, signal: 'SIGKILL' }), timeoutMs);
    });

    const { code, signal } = await Promise.race([agentExit, timeoutP]);
    clearTimeout(timeoutHandle!);

    if (signal === 'SIGKILL') {
      try { process.kill(-child.pid!, 'SIGKILL'); } catch {}
      try { appendFileSync(logFile, `[at] timeout: killed after ${timeoutMs}ms\n`); } catch {}
      await updateRun(options.stateDir, runId, {
        status: 'failed',
        finishedAt: new Date().toISOString(),
        exitCode: 1,
      });
      throw new Error(`${agentDef.name} killed after ${timeoutMs}ms timeout`);
    }

    const exitCode = code ?? 1;
    await updateRun(options.stateDir, runId, {
      status: exitCode === 0 ? 'done' : 'failed',
      finishedAt: new Date().toISOString(),
      exitCode,
    });

    return exitCode;
  };

  const readOutput = (): string => {
    if (!capturedLogFile) return '';
    try { return readFileSync(capturedLogFile, 'utf8').slice(-15000); } catch { return ''; }
  };

  try {
    const exitCode = await run(runOptions, effectiveAgents, customSpawner);
    const output = readOutput();
    if (exitCode !== 0) {
      return makeJsonResult({ success: false, agent: usedAgent?.name, exitCode, output, logFile: capturedLogFile }, true);
    }
    return makeJsonResult({ success: true, agent: usedAgent?.name, exitCode, output, logFile: capturedLogFile });
  } catch (err) {
    const output = readOutput();
    const message = err instanceof Error ? err.message : String(err);
    return makeJsonResult({ success: false, agent: usedAgent?.name, error: message, output, logFile: capturedLogFile }, true);
  }
}

async function handleListAgents(args: Record<string, unknown>, stateDir: string): Promise<CallToolResult> {
  const tier = args.tier as number | undefined;
  const stateFilePath = getStateFilePath(stateDir);
  const healthState = loadHealth(stateFilePath);
  const allAgents = applyTierOverrides([...AGENTS, ...loadGenericAgents()], loadConfig());
  const agents = tier !== undefined ? allAgents.filter(a => a.tier === tier) : allAgents;

  const result = await Promise.all(
    agents.map(async (a) => ({
      name: a.name,
      tier: a.tier,
      deactivated: isDeactivated(stateFilePath, a.name, healthState),
      healthy: await isHealthy(stateFilePath, a.name, healthState),
    })),
  );

  return makeJsonResult(result);
}

async function handleGetStatus(args: Record<string, unknown>, stateDir: string): Promise<CallToolResult> {
  const limit = (args.limit as number | undefined) ?? 10;
  const runs = loadRuns(stateDir);
  const withStuck = detectStuck(runs);
  const limited = withStuck.slice(0, limit);
  return makeJsonResult(limited);
}

async function handleDisableAgent(args: Record<string, unknown>, stateDir: string): Promise<CallToolResult> {
  const agentName = args.agent as string;
  if (!agentName) {
    return makeResult('Agent name is required', true);
  }
  const stateFilePath = getStateFilePath(stateDir);
  await setDeactivated(stateFilePath, agentName, true);
  return makeJsonResult({ message: `Agent "${agentName}" disabled` });
}

async function handleEnableAgent(args: Record<string, unknown>, stateDir: string): Promise<CallToolResult> {
  const agentName = args.agent as string;
  if (!agentName) {
    return makeResult('Agent name is required', true);
  }
  const stateFilePath = getStateFilePath(stateDir);
  await setDeactivated(stateFilePath, agentName, false);
  return makeJsonResult({ message: `Agent "${agentName}" enabled` });
}
