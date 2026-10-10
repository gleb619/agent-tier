import { parseJsonInput, resolveFromArgs } from '../src/resolver';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { resolveStateDir } from '../src/state-dir';

describe('parseJsonInput', () => {
  it('parses full JSON payload', () => {
    const opts = parseJsonInput(JSON.stringify({
      agent: 'mm-code',
      prompt: 'hello',
      model: 'gpt-4',
      cwd: '/tmp',
      env: { FOO: 'bar' },
    }));
    expect(opts.agent).toBe('mm-code');
    expect(opts.prompt).toBe('hello');
    expect(opts.model).toBe('gpt-4');
    expect(opts.cwd).toBe('/tmp');
    expect(opts.env).toEqual({ FOO: 'bar' });
  });

  it('defaults agent to "auto"', () => {
    expect(parseJsonInput(JSON.stringify({ prompt: 'hi' })).agent).toBe('auto');
  });

  it('throws when prompt is missing', () => {
    expect(() => parseJsonInput(JSON.stringify({ agent: 'mm-code' }))).toThrow('prompt');
  });

  it('throws on invalid JSON', () => {
    expect(() => parseJsonInput('not json')).toThrow();
  });
});

describe('resolveFromArgs', () => {
  it('applies all defaults (tier is undefined = line mode)', () => {
    const opts = resolveFromArgs({ prompt: 'hello' });
    expect(opts.agent).toBe('auto');
    expect(opts.tier).toBeUndefined();
    expect(opts.stream).toBe(false);
    expect(opts.stateDir).toBe(resolveStateDir());
    expect(opts.retries).toBe(0);
    expect(opts.logDir).toBe('/tmp/at-logs');
    expect(opts.noChop).toBe(false);
    expect(opts.timeout).toBe(3600000);
  });

  it('accepts tier as numeric string', () => {
    expect(resolveFromArgs({ prompt: 'hello', tier: '1' }).tier).toBe(1);
  });

  it('treats absent tier as undefined (line mode), not defaulting to 2', () => {
    const opts = resolveFromArgs({ prompt: 'hello' });
    expect(opts.tier).toBeUndefined();
  });

  it('accepts tier as numeric value', () => {
    expect(resolveFromArgs({ prompt: 'hello', tier: 3 }).tier).toBe(3);
  });

  it('accepts sandbox: true in argv', () => {
    expect(resolveFromArgs({ prompt: 'hello', sandbox: true }).sandbox).toBe(true);
  });

  it('sandbox defaults to undefined (falsy)', () => {
    expect(resolveFromArgs({ prompt: 'hello' }).sandbox).toBeUndefined();
  });

  it('defaults wait to false', () => {
    expect(resolveFromArgs({ prompt: 'hello' }).wait).toBe(false);
  });

  it('parses --wait into options', () => {
    const opts = resolveFromArgs({ prompt: 'hello', wait: true, stream: false });
    expect(opts.wait).toBe(true);
    expect(opts.stream).toBe(false);
  });

  it('leaves wait false in stream mode', () => {
    expect(resolveFromArgs({ prompt: 'hello', stream: true }).wait).toBe(false);
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

  it('treats empty-string agent as auto', () => {
    expect(resolveFromArgs({ prompt: 'test', agent: '' }).agent).toBe('auto');
  });

  it('treats whitespace-only agent as auto', () => {
    expect(resolveFromArgs({ prompt: 'test', agent: '   ' }).agent).toBe('auto');
  });

  it('accepts custom timeout', () => {
    expect(resolveFromArgs({ prompt: 'hello', timeout: '5000' }).timeout).toBe(5000);
  });

  it('uses explicit stateDir when provided', () => {
    expect(resolveFromArgs({ prompt: 'hello', stateDir: '/custom/.at' }).stateDir).toBe('/custom/.at');
  });

  it('passes through callback command', () => {
    expect(resolveFromArgs({ prompt: 'hello', callback: 'echo done' }).callback).toBe('echo done');
  });

  it('normalizes whitespace-only callback to undefined', () => {
    expect(resolveFromArgs({ prompt: 'hello', callback: '   ' }).callback).toBeUndefined();
  });

  it('normalizes empty callback to undefined', () => {
    expect(resolveFromArgs({ prompt: 'hello', callback: '' }).callback).toBeUndefined();
  });

  it('passes through verify command', () => {
    expect(resolveFromArgs({ prompt: 'hello', verify: 'npm test' }).verify).toBe('npm test');
  });

  it('normalizes whitespace-only verify to undefined', () => {
    expect(resolveFromArgs({ prompt: 'hello', verify: '   ' }).verify).toBeUndefined();
  });

  it('normalizes empty verify to undefined', () => {
    expect(resolveFromArgs({ prompt: 'hello', verify: '' }).verify).toBeUndefined();
  });

  it('defaults verify to undefined when not provided', () => {
    expect(resolveFromArgs({ prompt: 'hello' }).verify).toBeUndefined();
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
    expect(() => parseJsonInput(JSON.stringify({ agent: 'mm-code' }))).toThrow('prompt');
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
      agent: 'mm-code',
      prompt: 'minimal test',
    }));
    expect(opts.agent).toBe('mm-code');
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
  it('throws when env contains a non-string value', () => {
    expect(() =>
      parseJsonInput(JSON.stringify({
        agent: 'mm-code',
        prompt: 'hello',
        env: { FOO: 'bar', BAD: 123 },
      }))
    ).toThrow('JSON input: env values must be strings (got number for key "BAD")');
  });

  it('includes callback in parsed JSON', () => {
    const opts = parseJsonInput(JSON.stringify({ agent: 'mm-code', prompt: 'hello', callback: 'echo done' }));
    expect(opts.callback).toBe('echo done');
  });

  it('normalizes whitespace-only callback in JSON to undefined', () => {
    const opts = parseJsonInput(JSON.stringify({ agent: 'mm-code', prompt: 'hello', callback: '   ' }));
    expect(opts.callback).toBeUndefined();
  });

  it('includes verify in parsed JSON', () => {
    const opts = parseJsonInput(JSON.stringify({ agent: 'mm-code', prompt: 'hello', verify: 'npm test' }));
    expect(opts.verify).toBe('npm test');
  });

  it('normalizes whitespace-only verify in JSON to undefined', () => {
    const opts = parseJsonInput(JSON.stringify({ agent: 'mm-code', prompt: 'hello', verify: '   ' }));
    expect(opts.verify).toBeUndefined();
  });

  it('defaults verify to undefined when missing from JSON', () => {
    const opts = parseJsonInput(JSON.stringify({ agent: 'mm-code', prompt: 'hello' }));
    expect(opts.verify).toBeUndefined();
  });

  it('parses tier as number when present in JSON', () => {
    const opts = parseJsonInput(JSON.stringify({ agent: 'mm-code', prompt: 'hello', tier: 2 }));
    expect(opts.tier).toBe(2);
  });

  it('parses tier as numeric string in JSON', () => {
    const opts = parseJsonInput(JSON.stringify({ agent: 'mm-code', prompt: 'hello', tier: '3' }));
    expect(opts.tier).toBe(3);
  });

  it('treats absent tier in JSON as undefined (line mode)', () => {
    const opts = parseJsonInput(JSON.stringify({ agent: 'mm-code', prompt: 'hello' }));
    expect(opts.tier).toBeUndefined();
  });

  it('throws on invalid tier in JSON (string out of range)', () => {
    expect(() => parseJsonInput(JSON.stringify({ agent: 'mm-code', prompt: 'hello', tier: '9' })))
      .toThrow('tier');
  });

  it('throws on invalid tier in JSON (non-numeric string)', () => {
    expect(() => parseJsonInput(JSON.stringify({ agent: 'mm-code', prompt: 'hello', tier: 'foo' })))
      .toThrow('tier');
  });

  it('parses sandbox: true from JSON', () => {
    const opts = parseJsonInput(JSON.stringify({ agent: 'mm-code', prompt: 'hello', sandbox: true }));
    expect(opts.sandbox).toBe(true);
  });

  it('sandbox defaults to undefined in JSON', () => {
    const opts = parseJsonInput(JSON.stringify({ agent: 'mm-code', prompt: 'hello' }));
    expect(opts.sandbox).toBeUndefined();
  });
});

describe('parseJsonInput promptFile', () => {
  let tmpDir: string;
  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'at-prompt-file-'));
  });
  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function write(name: string, body: string): string {
    const p = path.join(tmpDir, name);
    fs.writeFileSync(p, body);
    return p;
  }

  it('resolves prompt from a .md file when promptFile is provided', () => {
    const p = write('hi.md', 'hello from md');
    const opts = parseJsonInput(JSON.stringify({ agent: 'mm-code', promptFile: p }));
    expect(opts.prompt).toBe('hello from md');
    expect(opts.promptFileContent).toBe('hello from md');
  });

  it('resolves prompt from a .json file (uses inner prompt field)', () => {
    const p = write('hi.json', JSON.stringify({ prompt: 'inside-json' }));
    const opts = parseJsonInput(JSON.stringify({ agent: 'mm-code', promptFile: p }));
    expect(opts.prompt).toBe('inside-json');
  });

  it('falls back to raw .json content when no inner prompt field', () => {
    const p = write('raw.json', '{"foo":"bar"}');
    const opts = parseJsonInput(JSON.stringify({ agent: 'mm-code', promptFile: p }));
    expect(opts.prompt).toBe('{"foo":"bar"}');
  });

  it('inline prompt wins over promptFile when both are provided', () => {
    const p = write('ignored.md', 'from file');
    const opts = parseJsonInput(JSON.stringify({ agent: 'mm-code', prompt: 'inline', promptFile: p }));
    expect(opts.prompt).toBe('inline');
  });

  it('throws when promptFile is a non-string', () => {
    expect(() =>
      parseJsonInput(JSON.stringify({ agent: 'mm-code', promptFile: 123 }))
    ).toThrow('promptFile must be a non-empty string');
  });

  it('throws when promptFile is empty string', () => {
    expect(() =>
      parseJsonInput(JSON.stringify({ agent: 'mm-code', promptFile: '   ' }))
    ).toThrow('promptFile must be a non-empty string');
  });

  it('throws when promptFile points to a missing file', () => {
    expect(() =>
      parseJsonInput(JSON.stringify({ agent: 'mm-code', promptFile: path.join(tmpDir, 'nope.md') }))
    ).toThrow(/Failed to read prompt file/);
  });

  it('throws when neither prompt nor promptFile is supplied', () => {
    expect(() =>
      parseJsonInput(JSON.stringify({ agent: 'mm-code' }))
    ).toThrow(/prompt is required/);
  });

  it('accepts a payload with only promptFile and no agent/prompt', () => {
    const p = write('only.md', 'lonely');
    const opts = parseJsonInput(JSON.stringify({ promptFile: p }));
    expect(opts.agent).toBe('auto');
    expect(opts.prompt).toBe('lonely');
  });
});
