import { run, Spawner, defaultSpawner } from '../src/runner';
import { RunOptions } from '../src/resolver';
import { AgentDef } from '../src/agents/registry';
import { existsSync, readFileSync, readdirSync, unlinkSync, rmdirSync } from 'fs';
import path from 'path';
import * as scheduler from '../src/scheduler';
import * as health from '../src/health';
import { Mock } from 'vitest';
import os from 'os';

vi.mock('../src/scheduler');
vi.mock('../src/health');
vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  const { EventEmitter } = await import('events');
  return {
    ...actual,
    spawn: vi.fn((...args: any[]) => {
      const cmd = args[0];
      if (cmd === '/nonexistent-binary-12345') {
        const child = new EventEmitter() as any;
        child.pid = undefined;
        child.stdin = null;
        child.stdout = null;
        child.stderr = null;
        return child;
      }
      return (actual.spawn as any)(...args);
    }),
  };
});

function makeAgent(name: string): AgentDef {
  return { name, tier: 2, bin: () => '/usr/bin/true', buildArgs: (p) => [p] };
}

const defaultStateDir = process.env.AT_STATE_DIR ?? path.join(os.homedir(), '.at');

const baseOptions: RunOptions = {
  agent: 'auto',
  tier: 2,
  prompt: 'hello',
  stream: true,
  stateDir: defaultStateDir,
  retries: 0,
  logDir: '/tmp/at-logs',
  noChop: false,
  timeout: 3600000,
};

const agents = [makeAgent('a'), makeAgent('b'), makeAgent('c')];

beforeEach(() => {
  vi.resetAllMocks();
  let callCount = 0;
  (scheduler.pickAgent as Mock).mockImplementation((candidates: AgentDef[]) => {
    return candidates[callCount++ % candidates.length];
  });
  (scheduler.getStateFile as Mock).mockReturnValue(path.join(defaultStateDir, 'state.json'));
  (health.filterHealthy as Mock).mockImplementation((_stateFile: string, agents: AgentDef[]) => agents);
  (health.recordResult as Mock).mockImplementation(() => Promise.resolve());
  (health.isDeactivated as Mock).mockReturnValue(false);
});

describe('run — auto mode', () => {
  it('resolves on first success', async () => {
    const spawner: Spawner = vi.fn().mockResolvedValue(0);
    await run(baseOptions, agents, spawner);
    expect(spawner).toHaveBeenCalledTimes(1);
  });

  it('does not retry when retries is 0', async () => {
    const spawner: Spawner = vi.fn().mockResolvedValue(1);
    await expect(run({ ...baseOptions, retries: 0 }, agents, spawner)).rejects.toThrow();
    expect(spawner).toHaveBeenCalledTimes(1);
  });

  it('retries up to retries count when retries option is set', async () => {
    const spawner: Spawner = vi.fn().mockResolvedValue(1);
    await expect(run({ ...baseOptions, retries: 2 }, agents, spawner)).rejects.toThrow();
    // 1 initial + 2 retries = 3, but pool is 3 so max attempts = 1 + min(2, 2) = 3
    expect(spawner).toHaveBeenCalledTimes(3);
  });

  it('caps retries at pool size minus one', async () => {
    const spawner: Spawner = vi.fn().mockResolvedValue(1);
    await expect(run({ ...baseOptions, retries: 10 }, agents, spawner)).rejects.toThrow();
    // pool has 3 agents, so max attempts = 1 + min(10, 2) = 3
    expect(spawner).toHaveBeenCalledTimes(3);
  });

  it('succeeds on retry after initial failure', async () => {
    const spawner: Spawner = vi.fn()
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(0);
    const exitCode = await run({ ...baseOptions, retries: 2 }, agents, spawner);
    expect(exitCode).toBe(0);
    expect(spawner).toHaveBeenCalledTimes(2);
  });

  it('throws after all agents fail', async () => {
    const spawner: Spawner = vi.fn().mockResolvedValue(1);
    await expect(run(baseOptions, agents, spawner)).rejects.toThrow();
  });

  it('throws when tier has no agents', async () => {
    const spawner: Spawner = vi.fn();
    await expect(run({ ...baseOptions, tier: 1 }, [], spawner)).rejects.toThrow('No agents');
  });
});

describe('run — named agent mode', () => {
  it('uses the named agent without calling scheduler', async () => {
    const spawner: Spawner = vi.fn().mockResolvedValue(0);
    await run({ ...baseOptions, agent: 'a' }, agents, spawner);
    const calledAgent = (spawner as Mock).mock.calls[0][0] as AgentDef;
    expect(calledAgent.name).toBe('a');
    expect(scheduler.pickAgent).not.toHaveBeenCalled();
  });

  it('throws for unknown named agent', async () => {
    const spawner: Spawner = vi.fn();
    await expect(run({ ...baseOptions, agent: 'unknown' }, agents, spawner)).rejects.toThrow('Unknown agent');
  });

  it('throws for deactivated agent', async () => {
    (health.isDeactivated as Mock).mockReturnValue(true);
    const spawner: Spawner = vi.fn();
    await expect(run({ ...baseOptions, agent: 'a' }, agents, spawner)).rejects.toThrow('deactivated');
  });

  it('does not retry named agent on failure', async () => {
    const spawner: Spawner = vi.fn().mockResolvedValue(1);
    await expect(run({ ...baseOptions, agent: 'a' }, agents, spawner)).rejects.toThrow();
    expect(spawner).toHaveBeenCalledTimes(1);
  });
});

describe('run — detached mode', () => {
  it('uses the spawner in detached mode', async () => {
    const spawner: Spawner = vi.fn().mockResolvedValue(0);
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

  it('creates a log file with runId header and agent output in detached mode', async () => {
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
    // Fire-and-forget: wait briefly for agent output to flush
    await new Promise((resolve) => setTimeout(resolve, 200));
    const files = readdirSync(tmpLogDir);
    expect(files.length).toBe(1);
    const logPath = path.join(tmpLogDir, files[0]);
    const content = readFileSync(logPath, 'utf8');
    expect(content).toContain('runId:');
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

  it('executes callback in stream mode with context env vars', async () => {
    const markerFile = path.join(tmpLogDir, 'callback-marker-stream.txt');
    const agent: AgentDef = {
      name: 'test',
      tier: 2,
      bin: () => '/bin/echo',
      buildArgs: (p) => [p],
    };
    const options: RunOptions = {
      ...baseOptions,
      stream: true,
      noChop: true,
      logDir: tmpLogDir,
      prompt: 'hello',
      callback: `sh -c 'echo "agent=$AT_AGENT status=$AT_STATUS exit=$AT_EXIT_CODE tier=$AT_TIER" > ${markerFile}'`,
    };
    const exitCode = await defaultSpawner(agent, options);
    expect(exitCode).toBe(0);
    const content = readFileSync(markerFile, 'utf8').trim();
    expect(content).toContain('agent=test');
    expect(content).toContain('status=done');
    expect(content).toContain('exit=0');
    expect(content).toContain('tier=2');
  });

  it('executes callback on failure with failed status', async () => {
    const markerFile = path.join(tmpLogDir, 'callback-marker-fail.txt');
    const agent: AgentDef = {
      name: 'test',
      tier: 2,
      bin: () => '/bin/bash',
      buildArgs: () => ['-c', 'exit 7'],
    };
    const options: RunOptions = {
      ...baseOptions,
      stream: true,
      noChop: true,
      logDir: tmpLogDir,
      prompt: 'hello',
      callback: `sh -c 'echo "status=$AT_STATUS exit=$AT_EXIT_CODE" > ${markerFile}'`,
    };
    const exitCode = await defaultSpawner(agent, options);
    expect(exitCode).toBe(7);
    const content = readFileSync(markerFile, 'utf8').trim();
    expect(content).toContain('status=failed');
    expect(content).toContain('exit=7');
  });

  it('does not fail main run when callback exits non-zero', async () => {
    const agent: AgentDef = {
      name: 'test',
      tier: 2,
      bin: () => '/bin/echo',
      buildArgs: (p) => [p],
    };
    const options: RunOptions = {
      ...baseOptions,
      stream: true,
      noChop: true,
      logDir: tmpLogDir,
      prompt: 'hello',
      callback: 'exit 42',
    };
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const exitCode = await defaultSpawner(agent, options);
    expect(exitCode).toBe(0);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('callback exited with code 42'));
    warnSpy.mockRestore();
  });

  it('executes callback in detached mode after child exits', async () => {
    const markerFile = path.join(tmpLogDir, 'callback-marker-detached.txt');
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
      callback: `sh -c 'echo "agent=$AT_AGENT status=$AT_STATUS" > ${markerFile}'`,
    };
    const exitCode = await defaultSpawner(agent, options);
    expect(exitCode).toBe(0);
    // Fire-and-forget: wait briefly for the close event and callback to fire
    await new Promise((resolve) => setTimeout(resolve, 300));
    const content = readFileSync(markerFile, 'utf8').trim();
    expect(content).toContain('agent=test');
    expect(content).toContain('status=done');
  });
});
