import { AgentDef } from '../src/agents/registry';
import { HealthState } from '../src/health';

const stateFile = `/tmp/at-health-test-${process.pid}.json`;

jest.mock('os', () => ({
  homedir: () => '/tmp/at-health-test-home',
}));

const store: Record<string, string> = {};

jest.mock('fs', () => ({
  existsSync: (p: string) => p in store,
  readFileSync: (p: string) => {
    if (p in store) return store[p];
    throw new Error('ENOENT');
  },
  writeFileSync: (p: string, data: string) => { store[p] = data; },
  mkdirSync: () => {},
}));

jest.mock('path', () => ({
  ...jest.requireActual('path'),
  join: (...args: string[]) => args.join('/'),
}));

const {
  loadHealth,
  saveHealth,
  recordResult,
  isHealthy,
  filterHealthy,
  resetAgent,
} = jest.requireActual('../src/health') as typeof import('../src/health');

function makeAgent(name: string): AgentDef {
  return { name, tier: 2, bin: () => `/usr/bin/${name}`, buildArgs: (p) => [p] };
}

const statePath = '/tmp/at-health-test-home/.at/state.json';

beforeEach(() => {
  for (const key of Object.keys(store)) delete store[key];
});

describe('loadHealth', () => {
  it('returns empty state when no file exists', () => {
    expect(loadHealth()).toEqual({ agents: {} });
  });

  it('reads existing state file', () => {
    const state: HealthState = { agents: { qwen: { failures: 2, disabledAt: null } } };
    store[statePath] = JSON.stringify(state);
    expect(loadHealth()).toEqual(state);
  });
});

describe('recordResult', () => {
  it('records a success (resets failures)', () => {
    recordResult('qwen', true);
    const written = JSON.parse(store[statePath]);
    expect(written.agents.qwen).toEqual({ failures: 0, disabledAt: null });
  });

  it('increments failures on failure', () => {
    recordResult('qwen', false);
    let state = JSON.parse(store[statePath]);
    expect(state.agents.qwen.failures).toBe(1);

    recordResult('qwen', false);
    state = JSON.parse(store[statePath]);
    expect(state.agents.qwen.failures).toBe(2);
  });

  it('disables agent after 3 consecutive failures', () => {
    recordResult('qwen', false);
    recordResult('qwen', false);
    recordResult('qwen', false);

    const state = JSON.parse(store[statePath]);
    expect(state.agents.qwen.failures).toBe(3);
    expect(state.agents.qwen.disabledAt).not.toBeNull();
  });

  it('resets failures on success after failures', () => {
    recordResult('qwen', false);
    recordResult('qwen', false);
    recordResult('qwen', true);

    const state = JSON.parse(store[statePath]);
    expect(state.agents.qwen).toEqual({ failures: 0, disabledAt: null });
  });

  it('does not re-disable already disabled agent', () => {
    recordResult('qwen', false);
    recordResult('qwen', false);
    recordResult('qwen', false);
    const firstDisabledAt = JSON.parse(store[statePath]).agents.qwen.disabledAt;

    recordResult('qwen', false);
    const state = JSON.parse(store[statePath]);
    expect(state.agents.qwen.disabledAt).toBe(firstDisabledAt);
  });
});

describe('isHealthy', () => {
  it('returns true for unknown agent', () => {
    expect(isHealthy('unknown')).toBe(true);
  });

  it('returns true when failures below threshold', () => {
    recordResult('qwen', false);
    expect(isHealthy('qwen')).toBe(true);
  });

  it('returns false when agent is disabled and cooldown not expired', () => {
    recordResult('qwen', false);
    recordResult('qwen', false);
    recordResult('qwen', false);
    expect(isHealthy('qwen')).toBe(false);
  });

  it('returns true when cooldown has expired', () => {
    const expired = new Date(Date.now() - 366 * 24 * 60 * 60 * 1000).toISOString();
    store[statePath] = JSON.stringify({
      agents: { qwen: { failures: 3, disabledAt: expired } },
    });
    expect(isHealthy('qwen')).toBe(true);
  });
});

describe('filterHealthy', () => {
  it('returns all agents when none are disabled', () => {
    const agents = [makeAgent('a'), makeAgent('b')];
    expect(filterHealthy(agents)).toEqual(agents);
  });

  it('filters out disabled agents', () => {
    const agents = [makeAgent('a'), makeAgent('b'), makeAgent('qwen')];
    store[statePath] = JSON.stringify({
      agents: { qwen: { failures: 3, disabledAt: new Date().toISOString() } },
    });

    const healthy = filterHealthy(agents);
    expect(healthy.map((a) => a.name)).toEqual(['a', 'b']);
  });
});

describe('resetAgent', () => {
  it('clears failures and disabledAt', () => {
    store[statePath] = JSON.stringify({
      agents: { qwen: { failures: 3, disabledAt: new Date().toISOString() } },
    });

    resetAgent('qwen');
    const state = JSON.parse(store[statePath]);
    expect(state.agents.qwen).toEqual({ failures: 0, disabledAt: null });
    expect(isHealthy('qwen')).toBe(true);
  });
});
