import { run, Spawner, defaultSpawner } from '../src/runner';
import { RunOptions } from '../src/resolver';
import { AgentDef } from '../src/agents/registry';
import { existsSync, readFileSync, readdirSync, unlinkSync, rmdirSync } from 'fs';
import path from 'path';
import * as scheduler from '../src/scheduler';
import * as health from '../src/health';

jest.mock('../src/scheduler');
jest.mock('../src/health');

function makeAgent(name: string): AgentDef {
  return { name, tier: 2, bin: () => '/usr/bin/true', buildArgs: (p) => [p] };
}

const baseOptions: RunOptions = {
  agent: 'auto',
  tier: 2,
  prompt: 'hello',
  stream: true,
  globalState: false,
  retries: 0,
  logDir: '/tmp/at-logs',
  orchestrate: false,
  noChop: false,
  timeout: 3600000,
};

const agents = [makeAgent('a'), makeAgent('b'), makeAgent('c')];

beforeEach(() => {
  jest.resetAllMocks();
  let callCount = 0;
  (scheduler.pickAgent as jest.Mock).mockImplementation((candidates: AgentDef[]) => {
    return candidates[callCount++ % candidates.length];
  });
  (scheduler.getStateFile as jest.Mock).mockReturnValue('/tmp/at-test-state.json');
  (health.filterHealthy as jest.Mock).mockImplementation((agents: AgentDef[]) => agents);
  (health.recordResult as jest.Mock).mockImplementation(() => {});
});

describe('run — auto mode', () => {
  it('resolves on first success', async () => {
    const spawner: Spawner = jest.fn().mockResolvedValue(0);
    await run(baseOptions, agents, spawner);
    expect(spawner).toHaveBeenCalledTimes(1);
  });

  it('does not retry on first failure', async () => {
    const spawner: Spawner = jest.fn().mockResolvedValue(1);
    await expect(run(baseOptions, agents, spawner)).rejects.toThrow();
    expect(spawner).toHaveBeenCalledTimes(1);
  });

  it('does not retry even when retries option is set', async () => {
    const spawner: Spawner = jest.fn().mockResolvedValue(1);
    await expect(run({ ...baseOptions, retries: 2 }, agents, spawner)).rejects.toThrow();
    expect(spawner).toHaveBeenCalledTimes(1);
  });

  it('does not retry even when retries exceed pool', async () => {
    const spawner: Spawner = jest.fn().mockResolvedValue(1);
    await expect(run({ ...baseOptions, retries: 10 }, agents, spawner)).rejects.toThrow();
    expect(spawner).toHaveBeenCalledTimes(1);
  });

  it('throws after all agents fail', async () => {
    const spawner: Spawner = jest.fn().mockResolvedValue(1);
    await expect(run(baseOptions, agents, spawner)).rejects.toThrow();
  });

  it('throws when tier has no agents', async () => {
    const spawner: Spawner = jest.fn();
    await expect(run({ ...baseOptions, tier: 1 }, [], spawner)).rejects.toThrow('No agents');
  });
});

describe('run — named agent mode', () => {
  it('uses the named agent without calling scheduler', async () => {
    const spawner: Spawner = jest.fn().mockResolvedValue(0);
    await run({ ...baseOptions, agent: 'a' }, agents, spawner);
    const calledAgent = (spawner as jest.Mock).mock.calls[0][0] as AgentDef;
    expect(calledAgent.name).toBe('a');
    expect(scheduler.pickAgent).not.toHaveBeenCalled();
  });

  it('throws for unknown named agent', async () => {
    const spawner: Spawner = jest.fn();
    await expect(run({ ...baseOptions, agent: 'unknown' }, agents, spawner)).rejects.toThrow('Unknown agent');
  });

  it('does not retry named agent on failure', async () => {
    const spawner: Spawner = jest.fn().mockResolvedValue(1);
    await expect(run({ ...baseOptions, agent: 'a' }, agents, spawner)).rejects.toThrow();
    expect(spawner).toHaveBeenCalledTimes(1);
  });
});

describe('run — detached mode', () => {
  it('uses the spawner in detached mode', async () => {
    const spawner: Spawner = jest.fn().mockResolvedValue(0);
    await run({ ...baseOptions, stream: false }, agents, spawner);
    expect(spawner).toHaveBeenCalledTimes(1);
  });
});

describe('defaultSpawner', () => {
  const tmpLogDir = '/tmp/at-test-logs-runner';

  beforeEach(() => {
    if (existsSync(tmpLogDir)) {
      for (const f of readdirSync(tmpLogDir)) {
        unlinkSync(path.join(tmpLogDir, f));
      }
      rmdirSync(tmpLogDir);
    }
  });

  it('creates a non-empty log file in stream mode', async () => {
    const agent: AgentDef = {
      name: 'test',
      tier: 2,
      bin: () => '/bin/echo',
      buildArgs: (p) => [p],
    };
    const options: RunOptions = {
      ...baseOptions,
      stream: true,
      logDir: tmpLogDir,
      prompt: 'hello',
    };
    const exitCode = await defaultSpawner(agent, options);
    expect(exitCode).toBe(0);
    const files = readdirSync(tmpLogDir);
    expect(files.length).toBe(1);
    const logPath = path.join(tmpLogDir, files[0]);
    const content = readFileSync(logPath, 'utf8');
    expect(content.length).toBeGreaterThan(0);
    expect(content).toContain('hello');
  });

  it('creates a non-empty log file in detached mode', async () => {
    const agent: AgentDef = {
      name: 'test',
      tier: 2,
      bin: () => '/bin/echo',
      buildArgs: (p) => [p],
    };
    const options: RunOptions = {
      ...baseOptions,
      stream: false,
      logDir: tmpLogDir,
      prompt: 'hello',
    };
    const exitCode = await defaultSpawner(agent, options);
    expect(exitCode).toBe(0);
    const files = readdirSync(tmpLogDir);
    expect(files.length).toBe(1);
    const logPath = path.join(tmpLogDir, files[0]);
    const content = readFileSync(logPath, 'utf8');
    expect(content.length).toBeGreaterThan(0);
    expect(content).toContain('hello');
  });

  it('writes spawn error to log file in stream mode', async () => {
    const agent: AgentDef = {
      name: 'test',
      tier: 2,
      bin: () => '/nonexistent-binary-12345',
      buildArgs: (p) => [p],
    };
    const options: RunOptions = {
      ...baseOptions,
      stream: true,
      noChop: true,
      logDir: tmpLogDir,
      prompt: 'hello',
    };
    await expect(defaultSpawner(agent, options)).rejects.toThrow('no PID assigned');
    // createWriteStream opens the file asynchronously; give it a tick to land
    await new Promise((resolve) => setTimeout(resolve, 50));
    const files = readdirSync(tmpLogDir);
    expect(files.length).toBe(1);
    const logPath = path.join(tmpLogDir, files[0]);
    const content = readFileSync(logPath, 'utf8');
    expect(content.length).toBeGreaterThan(0);
    expect(content).toContain('Failed to spawn');
  });

  it('writes spawn error to log file in detached mode', async () => {
    const agent: AgentDef = {
      name: 'test',
      tier: 2,
      bin: () => '/nonexistent-binary-12345',
      buildArgs: (p) => [p],
    };
    const options: RunOptions = {
      ...baseOptions,
      stream: false,
      logDir: tmpLogDir,
      prompt: 'hello',
    };
    await expect(defaultSpawner(agent, options)).rejects.toThrow('no PID assigned');
    const files = readdirSync(tmpLogDir);
    expect(files.length).toBe(1);
    const logPath = path.join(tmpLogDir, files[0]);
    const content = readFileSync(logPath, 'utf8');
    expect(content.length).toBeGreaterThan(0);
    expect(content).toContain('Failed to spawn');
  });
});
