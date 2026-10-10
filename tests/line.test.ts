import { getLineAgents, AtConfig } from '../src/config';
import { AgentDef } from '../src/agents/registry';

function makeAgent(name: string, tier: 1 | 2 | 3 | 4 = 2): AgentDef {
  return { name, tier, bin: () => '/usr/bin/true', buildArgs: (p) => [p] };
}

describe('getLineAgents', () => {
  it('default order: non-tier-4 agents sorted t3 first, then t2, then t1 (stable within tier)', () => {
    const agents = [
      makeAgent('glm-code', 1),
      makeAgent('codex', 1),
      makeAgent('mm-code', 2),
      makeAgent('opencode', 2),
      makeAgent('kilo', 3),
      makeAgent('agy', 3),
      makeAgent('mock', 4),
    ];
    const result = getLineAgents(agents, null);
    expect(result.map((a) => a.name)).toEqual([
      'kilo', 'agy',         // tier 3
      'mm-code', 'opencode', // tier 2
      'glm-code', 'codex',   // tier 1
    ]);
  });

  it('excludes tier-4 (mocks) from default order', () => {
    const agents = [
      makeAgent('a', 2),
      makeAgent('b', 4),
      makeAgent('c', 3),
    ];
    const result = getLineAgents(agents, null);
    expect(result.map((a) => a.name)).toEqual(['c', 'a']);
  });

  it('honors custom config.line order (custom names, custom sequence)', () => {
    const agents = [
      makeAgent('a', 1),
      makeAgent('b', 3),
      makeAgent('c', 2),
    ];
    const config: AtConfig = { line: ['c', 'a', 'b'] };
    const result = getLineAgents(agents, config);
    expect(result.map((ag) => ag.name)).toEqual(['c', 'a', 'b']);
  });

  it('skips unknown agent names with console.warn', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const agents = [makeAgent('a', 2), makeAgent('b', 3)];
    const config: AtConfig = { line: ['a', 'nope', 'b'] };
    const result = getLineAgents(agents, config);
    expect(result.map((ag) => ag.name)).toEqual(['a', 'b']);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('unknown agent "nope"'));
    warnSpy.mockRestore();
  });

  it('quiet suppresses unknown-agent warn', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const agents = [makeAgent('a', 2), makeAgent('b', 3)];
    const config: AtConfig = { line: ['a', 'nope', 'b'] };
    const result = getLineAgents(agents, config, { quiet: true });
    expect(result.map((ag) => ag.name)).toEqual(['a', 'b']);
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('deduplicates config.line entries (keeps first occurrence)', () => {
    const agents = [makeAgent('a', 1), makeAgent('b', 2), makeAgent('c', 3)];
    const config: AtConfig = { line: ['a', 'b', 'a', 'c', 'b'] };
    const result = getLineAgents(agents, config);
    expect(result.map((ag) => ag.name)).toEqual(['a', 'b', 'c']);
  });

  it('throws when resolved line is empty (all names unknown)', () => {
    const agents = [makeAgent('a', 2)];
    const config: AtConfig = { line: ['nope', 'nada'] };
    expect(() => getLineAgents(agents, config)).toThrow(/line config is empty/);
  });

  it('throws when all default-order agents are tier 4 (empty default line)', () => {
    const agents = [makeAgent('mock', 4), makeAgent('mock-long', 4)];
    expect(() => getLineAgents(agents, null)).toThrow(/line config is empty/);
  });

  it('returns empty line candidate when config.line is empty array (treated as "empty resolved")', () => {
    // Empty array short-circuits default — but produces empty result, so throws.
    const agents = [makeAgent('a', 2)];
    const config: AtConfig = { line: [] };
    expect(() => getLineAgents(agents, config)).toThrow(/line config is empty/);
  });

  it('uses provided agents array (not the global AGENTS registry)', () => {
    // Lookup must hit the passed-in array, not the module-level AGENTS list.
    // 'mm-code' exists in the global AGENTS but NOT in the passed-in array —
    // it should be skipped, and the empty resolved line should throw.
    const agents = [makeAgent('only-this', 2)];
    const config: AtConfig = { line: ['mm-code'] };
    expect(() => getLineAgents(agents, config)).toThrow(/line config is empty/);
  });
});
