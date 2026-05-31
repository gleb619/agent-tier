import { AGENTS, getAgentsByTier, getAgentByName } from '../src/agents/registry';

describe('AgentRegistry', () => {
  it('has 15 agents defined', () => {
    expect(AGENTS).toHaveLength(16);
  });

  it('has 3 tier-1 agents', () => {
    expect(getAgentsByTier(1)).toHaveLength(3);
  });

  it('has 5 tier-2 agents', () => {
    expect(getAgentsByTier(2)).toHaveLength(5);
  });

  it('has 5 tier-3 agents', () => {
    expect(getAgentsByTier(3)).toHaveLength(6);
  });

  it('has 2 tier-4 agents', () => {
    expect(getAgentsByTier(4)).toHaveLength(2);
    expect(getAgentsByTier(4)[0].name).toBe('mock');
    expect(getAgentsByTier(4)[1].name).toBe('mock-long');
  });

  it('finds agent by name', () => {
    expect(getAgentByName('blackbox')?.name).toBe('blackbox');
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

  it('blackbox bin resolves to a string', () => {
    expect(typeof getAgentByName('blackbox')!.bin()).toBe('string');
  });

  it('blackbox buildArgs includes prompt', () => {
    expect(getAgentByName('blackbox')!.buildArgs('hello world')).toContain('hello world');
  });

  it('opencode buildArgs includes -m when model provided', () => {
    const args = getAgentByName('opencode')!.buildArgs('hello', 'gpt-4');
    expect(args).toContain('-m');
    expect(args).toContain('gpt-4');
  });

  it('opencode buildArgs omits -m when no model', () => {
    expect(getAgentByName('opencode')!.buildArgs('hello')).not.toContain('-m');
  });

  it('gemini uses stdin promptMode', () => {
    expect(getAgentByName('gemini')!.promptMode).toBe('stdin');
  });
});

describe('getAgentsByTier', () => {
  it('returns tier 1 agents: glm-code, codex, kimi', () => {
    const tier1 = getAgentsByTier(1);
    expect(tier1).toHaveLength(3);
    expect(tier1.map(a => a.name)).toEqual(expect.arrayContaining(['glm-code', 'codex', 'kimi']));
  });

  it('returns tier 2 agents: blackbox, mm-code, opencode, qwen, pi', () => {
    const tier2 = getAgentsByTier(2);
    expect(tier2).toHaveLength(5);
    expect(tier2.map(a => a.name)).toEqual(expect.arrayContaining(['blackbox', 'mm-code', 'opencode', 'qwen', 'pi']));
  });

  it('returns tier 3 agents', () => {
    const tier3 = getAgentsByTier(3);
    expect(tier3.length).toBeGreaterThan(0);
    const names = tier3.map(a => a.name);
    expect(names).toContain('gemini');
    expect(names).toContain('aider');
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
    const agent = getAgentByName('gemini');
    expect(agent?.tier).toBe(3);
  });

  it('returns undefined for unknown name', () => {
    expect(getAgentByName('nonexistent')).toBeUndefined();
  });
});
