import { run, Spawner } from '../src/runner';
import { RunOptions } from '../src/resolver';
import { AgentDef } from '../src/agents/registry';
import * as scheduler from '../src/scheduler';

jest.mock('../src/scheduler');

function makeAgent(name: string): AgentDef {
  return { name, tier: 2, bin: () => '/usr/bin/true', buildArgs: (p) => [p] };
}

const baseOptions: RunOptions = {
  agent: 'auto',
  tier: 2,
  prompt: 'hello',
  stream: true,
  globalState: false,
  retries: 2,
  logDir: '/tmp/at-logs',
};

const agents = [makeAgent('a'), makeAgent('b'), makeAgent('c')];

beforeEach(() => {
  jest.resetAllMocks();
  let callCount = 0;
  (scheduler.pickAgent as jest.Mock).mockImplementation((candidates: AgentDef[]) => {
    return candidates[callCount++ % candidates.length];
  });
  (scheduler.getStateFile as jest.Mock).mockReturnValue('/tmp/at-test-state.json');
});

describe('run — auto mode', () => {
  it('resolves on first success', async () => {
    const spawner: Spawner = jest.fn().mockResolvedValue(0);
    await run(baseOptions, agents, spawner);
    expect(spawner).toHaveBeenCalledTimes(1);
  });

  it('retries once on first failure', async () => {
    const spawner: Spawner = jest.fn()
      .mockResolvedValueOnce(1)
      .mockResolvedValue(0);
    await run(baseOptions, agents, spawner);
    expect(spawner).toHaveBeenCalledTimes(2);
  });

  it('retries up to retries+1 total attempts', async () => {
    const spawner: Spawner = jest.fn().mockResolvedValue(1);
    await expect(run({ ...baseOptions, retries: 2 }, agents, spawner)).rejects.toThrow();
    expect(spawner).toHaveBeenCalledTimes(3);
  });

  it('caps total attempts at agents.length when retries exceeds pool', async () => {
    const spawner: Spawner = jest.fn().mockResolvedValue(1);
    await expect(run({ ...baseOptions, retries: 10 }, agents, spawner)).rejects.toThrow();
    expect(spawner).toHaveBeenCalledTimes(3);
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
  it('resolves immediately without waiting for child in detached mode', async () => {
    const spawner: Spawner = jest.fn().mockResolvedValue(0);
    await run({ ...baseOptions, stream: false }, agents, spawner);
    expect(spawner).toHaveBeenCalledTimes(1);
  });
});
