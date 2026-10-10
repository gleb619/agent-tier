import { AGENTS, getAgentsByTier, getAgentByName } from '../src/agents/registry';

describe('AgentRegistry', () => {
  it('has 14 agents defined', () => {
    expect(AGENTS).toHaveLength(14);
  });

  it('has 3 tier-1 agents', () => {
    expect(getAgentsByTier(1)).toHaveLength(3);
  });

  it('has 5 tier-2 agents', () => {
    expect(getAgentsByTier(2)).toHaveLength(5);
  });

  it('has 4 tier-3 agents', () => {
    expect(getAgentsByTier(3)).toHaveLength(4);
  });

  it('has 2 tier-4 agents', () => {
    expect(getAgentsByTier(4)).toHaveLength(2);
    expect(getAgentsByTier(4)[0].name).toBe('mock');
    expect(getAgentsByTier(4)[1].name).toBe('mock-long');
  });

  it('finds agent by name', () => {
    expect(getAgentByName('mm-code')?.name).toBe('mm-code');
  });

  it('returns undefined for unknown agent', () => {
    expect(getAgentByName('unknown')).toBeUndefined();
  });

  it('finds cline agent by name', () => {
    expect(getAgentByName('cline')?.name).toBe('cline');
  });

  it('cline buildArgs includes auto-approve and json', () => {
    const args = getAgentByName('cline')!.buildArgs('hello world');
    expect(args).toContain('--auto-approve');
    expect(args).toContain('--json');
    expect(args).toContain('hello world');
  });

  it('finds mock agent by name', () => {
    expect(getAgentByName('mock')?.name).toBe('mock');
  });

  it('mock agent buildArgs includes prompt', () => {
    expect(getAgentByName('mock')!.buildArgs('test prompt')).toContain('test prompt');
  });

  it('mm-code bin resolves to a string', () => {
    expect(typeof getAgentByName('mm-code')!.bin()).toBe('string');
  });

  it('mm-code buildArgs includes prompt', () => {
    expect(getAgentByName('mm-code')!.buildArgs('hello world')).toContain('hello world');
  });

  it('opencode buildArgs includes -m when model provided', () => {
    const args = getAgentByName('opencode')!.buildArgs('hello', 'gpt-4');
    expect(args).toContain('-m');
    expect(args).toContain('gpt-4');
  });

  it('opencode buildArgs omits -m when no model', () => {
    expect(getAgentByName('opencode')!.buildArgs('hello')).not.toContain('-m');
  });

  it('agy passes prompt via -p', () => {
    const agy = getAgentByName('agy')!;
    expect(agy.promptMode).toBeUndefined();
    expect(agy.buildArgs('hi')).toEqual(['--dangerously-skip-permissions', '-p', 'hi']);
  });

  it('pi buildArgs passes -p and prompt without ollama provider/model', () => {
    const args = getAgentByName('pi')!.buildArgs('hello');
    expect(args).toEqual(['-p', 'hello']);
    expect(args).not.toContain('--provider');
    expect(args).not.toContain('ollama');
  });

  it('pi buildArgs includes --model when model provided', () => {
    const args = getAgentByName('pi')!.buildArgs('hello', 'custom-model');
    expect(args).toEqual(['-p', '--model', 'custom-model', 'hello']);
  });

  it('cline passes run cwd via --cwd', () => {
    const args = getAgentByName('cline')!.buildArgs('hi', undefined, '/tmp/sbx');
    expect(args).toEqual(expect.arrayContaining(['--cwd', '/tmp/sbx']));
  });

  it('finds devin agent by name', () => {
    expect(getAgentByName('devin')?.name).toBe('devin');
  });

  it('devin agent is tier 3', () => {
    expect(getAgentByName('devin')?.tier).toBe(3);
  });

  it('devin buildArgs includes permission-mode bypass, -p, and prompt', () => {
    const args = getAgentByName('devin')!.buildArgs('fix the bug');
    expect(args).toContain('--permission-mode');
    expect(args).toContain('bypass');
    expect(args).toContain('--respect-workspace-trust');
    expect(args).toContain('false');
    expect(args).toContain('-p');
    expect(args).toContain('fix the bug');
  });

  it('devin bin prefers env override', () => {
    const orig = process.env.DEVIN_BIN;
    process.env.DEVIN_BIN = '/custom/devin';
    expect(getAgentByName('devin')!.bin()).toBe('/custom/devin');
    if (orig === undefined) delete process.env.DEVIN_BIN; else process.env.DEVIN_BIN = orig;
  });

  it('devin bin resolves to a string', () => {
    expect(typeof getAgentByName('devin')!.bin()).toBe('string');
  });
});

describe('getAgentsByTier', () => {
  it('returns tier 1 agents: glm-code, codex, kimi', () => {
    const tier1 = getAgentsByTier(1);
    expect(tier1).toHaveLength(3);
    expect(tier1.map(a => a.name)).toEqual(expect.arrayContaining(['glm-code', 'codex', 'kimi']));
  });

  it('returns tier 2 agents: mm-code, opencode, qwen, pi, cline', () => {
    const tier2 = getAgentsByTier(2);
    expect(tier2).toHaveLength(5);
    expect(tier2.map(a => a.name)).toEqual(expect.arrayContaining(['mm-code', 'opencode', 'qwen', 'pi', 'cline']));
  });

  it('returns tier 3 agents', () => {
    const tier3 = getAgentsByTier(3);
    expect(tier3.length).toBeGreaterThan(0);
    const names = tier3.map(a => a.name);
    expect(names).toContain('kilo');
    expect(names).toContain('agy');
    expect(names).toContain('kiro');
    expect(names).toContain('devin');
  });

  it('returns tier 4 agents: mock, mock-long', () => {
    const tier4 = getAgentsByTier(4);
    expect(tier4).toHaveLength(2);
  });

  it('returns empty for agents not in that tier', () => {
    const tier4 = getAgentsByTier(4);
    expect(tier4.map(a => a.name)).not.toContain('glm-code');
  });
});

describe('getAgentByName', () => {
  it('returns agent definition for known name', () => {
    const agent = getAgentByName('agy');
    expect(agent?.tier).toBe(3);
  });

  it('returns undefined for unknown name', () => {
    expect(getAgentByName('nonexistent')).toBeUndefined();
  });
});

import { applyNormkaFlag } from '../src/agents/normka-flag';

describe('normka flag wiring (registry side)', () => {
  it('mock agent is tier 4', () => {
    expect(getAgentByName('mock')?.tier).toBe(4);
  });
  it('mock-long agent is tier 4', () => {
    expect(getAgentByName('mock-long')?.tier).toBe(4);
  });
  it('appending --normka works on tier 4 mock via applyNormkaFlag', () => {
    const a = getAgentByName('mock')!;
    const baseArgs = a.buildArgs('hello');
    const args = applyNormkaFlag(a, baseArgs, 'hello', { normka: true });
    expect(args).toEqual(['hello', '--normka']);
  });
  it('mm-code agent does not get --normka even when caller opts in', () => {
    const a = getAgentByName('mm-code')!;
    const baseArgs = a.buildArgs('hello');
    const args = applyNormkaFlag(a, baseArgs, 'hello', { normka: true });
    expect(args).not.toContain('--normka');
  });
});
