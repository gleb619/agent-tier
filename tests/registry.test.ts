import { AGENTS, getAgentsByTier, getAgentByName } from '../src/agents/registry';

describe('AgentRegistry', () => {
  it('has 13 agents defined', () => {
    expect(AGENTS).toHaveLength(13);
  });

  it('has 4 tier-1 agents', () => {
    expect(getAgentsByTier(1)).toHaveLength(4);
  });

  it('has 4 tier-2 agents', () => {
    expect(getAgentsByTier(2)).toHaveLength(4);
  });

  it('has 5 tier-3 agents', () => {
    expect(getAgentsByTier(3)).toHaveLength(5);
  });

  it('finds agent by name', () => {
    expect(getAgentByName('blackbox')?.name).toBe('blackbox');
  });

  it('returns undefined for unknown agent', () => {
    expect(getAgentByName('unknown')).toBeUndefined();
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
