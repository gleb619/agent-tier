import { parseJsonInput, resolveFromArgs } from '../src/resolver';

describe('parseJsonInput', () => {
  it('parses full JSON payload', () => {
    const opts = parseJsonInput(JSON.stringify({
      agent: 'blackbox',
      prompt: 'hello',
      model: 'gpt-4',
      cwd: '/tmp',
      env: { FOO: 'bar' },
    }));
    expect(opts.agent).toBe('blackbox');
    expect(opts.prompt).toBe('hello');
    expect(opts.model).toBe('gpt-4');
    expect(opts.cwd).toBe('/tmp');
    expect(opts.env).toEqual({ FOO: 'bar' });
  });

  it('defaults agent to "auto"', () => {
    expect(parseJsonInput(JSON.stringify({ prompt: 'hi' })).agent).toBe('auto');
  });

  it('throws when prompt is missing', () => {
    expect(() => parseJsonInput(JSON.stringify({ agent: 'blackbox' }))).toThrow('prompt');
  });

  it('throws on invalid JSON', () => {
    expect(() => parseJsonInput('not json')).toThrow();
  });
});

describe('resolveFromArgs', () => {
  it('applies all defaults', () => {
    const opts = resolveFromArgs({ prompt: 'hello' });
    expect(opts.agent).toBe('auto');
    expect(opts.tier).toBe(2);
    expect(opts.stream).toBe(false);
    expect(opts.globalState).toBe(false);
    expect(opts.retries).toBe(2);
    expect(opts.logDir).toBe('/tmp/at-logs');
    expect(opts.orchestrate).toBe(false);
  });

  it('accepts tier as numeric string', () => {
    expect(resolveFromArgs({ prompt: 'hello', tier: '1' }).tier).toBe(1);
  });

  it('throws for invalid tier', () => {
    expect(() => resolveFromArgs({ prompt: 'hello', tier: '4' })).toThrow('tier');
  });

  it('throws when prompt is empty', () => {
    expect(() => resolveFromArgs({ prompt: '' })).toThrow('prompt');
  });

  it('passes through agent name', () => {
    expect(resolveFromArgs({ prompt: 'hello', agent: 'glm-code' }).agent).toBe('glm-code');
  });
});
