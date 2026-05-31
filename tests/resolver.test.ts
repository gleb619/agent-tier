import { parseJsonInput, resolveFromArgs } from '../src/resolver';
import path from 'path';
import os from 'os';

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
    expect(opts.stateDir).toBe(path.join(os.homedir(), '.at'));
    expect(opts.retries).toBe(0);
    expect(opts.logDir).toBe('/tmp/at-logs');
    expect(opts.noChop).toBe(false);
    expect(opts.timeout).toBe(3600000);
  });

  it('accepts tier as numeric string', () => {
    expect(resolveFromArgs({ prompt: 'hello', tier: '1' }).tier).toBe(1);
  });

  it('throws for invalid tier', () => {
    expect(() => resolveFromArgs({ prompt: 'hello', tier: '5' })).toThrow('tier');
  });

  it('throws when prompt is empty', () => {
    expect(() => resolveFromArgs({ prompt: '' })).toThrow('prompt');
  });

  it('passes through agent name', () => {
    expect(resolveFromArgs({ prompt: 'hello', agent: 'glm-code' }).agent).toBe('glm-code');
  });

  it('accepts custom timeout', () => {
    expect(resolveFromArgs({ prompt: 'hello', timeout: '5000' }).timeout).toBe(5000);
  });

  it('uses explicit stateDir when provided', () => {
    expect(resolveFromArgs({ prompt: 'hello', stateDir: '/custom/.at' }).stateDir).toBe('/custom/.at');
  });
});

describe('parseJsonInput edge cases', () => {
  it('throws on malformed JSON', () => {
    expect(() => parseJsonInput('{invalid json}')).toThrow();
  });

  it('throws on empty string', () => {
    expect(() => parseJsonInput('')).toThrow();
  });

  it('defaults agent to auto when agent field is missing', () => {
    expect(parseJsonInput(JSON.stringify({ prompt: 'hello' })).agent).toBe('auto');
  });

  it('throws when prompt field is missing', () => {
    expect(() => parseJsonInput(JSON.stringify({ agent: 'blackbox' }))).toThrow('prompt');
  });

  it('returns valid parsed input with all fields', () => {
    const opts = parseJsonInput(JSON.stringify({
      agent: 'kimi',
      prompt: 'fix the bug',
      model: 'claude-3-5-sonnet',
      cwd: '/home/user/project',
      env: { NODE_ENV: 'test', DEBUG: 'true' },
    }));
    expect(opts.agent).toBe('kimi');
    expect(opts.prompt).toBe('fix the bug');
    expect(opts.model).toBe('claude-3-5-sonnet');
    expect(opts.cwd).toBe('/home/user/project');
    expect(opts.env).toEqual({ NODE_ENV: 'test', DEBUG: 'true' });
  });

  it('handles JSON with only required fields (agent + prompt)', () => {
    const opts = parseJsonInput(JSON.stringify({
      agent: 'blackbox',
      prompt: 'minimal test',
    }));
    expect(opts.agent).toBe('blackbox');
    expect(opts.prompt).toBe('minimal test');
    expect(opts.model).toBeUndefined();
    expect(opts.cwd).toBeUndefined();
    expect(opts.env).toBeUndefined();
  });

  it('handles extra fields gracefully', () => {
    const opts = parseJsonInput(JSON.stringify({
      agent: 'opencode',
      prompt: 'hello',
      unknownField: 'should be ignored',
      anotherExtra: 12345,
      nested: { foo: 'bar' },
    }));
    expect(opts.agent).toBe('opencode');
    expect(opts.prompt).toBe('hello');
  });
});
