import fs from 'fs';
import path from 'path';
import os from 'os';

function makeDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'at-generic-test-'));
}

function writeGenericJs(dir: string, name: string, content: string): void {
  const agentDir = path.join(dir, name);
  fs.mkdirSync(agentDir, { recursive: true });
  fs.writeFileSync(path.join(agentDir, 'generic.js'), content);
}

describe('loadGenericAgents', () => {
  const originalEnv = process.env.AT_GENERIC_DIR;

  afterEach(() => {
    process.env.AT_GENERIC_DIR = originalEnv;
    jest.resetModules();
  });

  function load() {
    // Re-require after env change so the module sees fresh env
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('../src/agents/generic-loader').loadGenericAgents();
  }

  it('returns [] when base dir does not exist', () => {
    process.env.AT_GENERIC_DIR = '/tmp/at-generic-nonexistent-dir-xyz';
    expect(load()).toEqual([]);
  });

  it('returns [] when base dir is empty', () => {
    const dir = makeDir();
    process.env.AT_GENERIC_DIR = dir;
    expect(load()).toEqual([]);
    fs.rmSync(dir, { recursive: true });
  });

  it('loads a valid generic.js and sets name from directory', () => {
    const dir = makeDir();
    writeGenericJs(dir, 'myagent', `
      module.exports = {
        tier: 2,
        bin: () => '/usr/bin/myagent',
        buildArgs: (prompt) => ['-p', prompt],
      };
    `);
    process.env.AT_GENERIC_DIR = dir;

    const agents = load();
    expect(agents).toHaveLength(1);
    expect(agents[0].name).toBe('myagent');
    expect(agents[0].tier).toBe(2);
    fs.rmSync(dir, { recursive: true });
  });

  it('bin() returns the value from generic.js', () => {
    const dir = makeDir();
    writeGenericJs(dir, 'myagent', `
      module.exports = {
        tier: 1,
        bin: () => '/custom/bin/myagent',
        buildArgs: (prompt) => [prompt],
      };
    `);
    process.env.AT_GENERIC_DIR = dir;

    const agents = load();
    expect(agents[0].bin()).toBe('/custom/bin/myagent');
    fs.rmSync(dir, { recursive: true });
  });

  it('buildArgs() works correctly', () => {
    const dir = makeDir();
    writeGenericJs(dir, 'myagent', `
      module.exports = {
        tier: 3,
        bin: () => '/usr/bin/myagent',
        buildArgs: (prompt) => ['--prompt', prompt, '--flag'],
      };
    `);
    process.env.AT_GENERIC_DIR = dir;

    const agents = load();
    expect(agents[0].buildArgs('hello world')).toEqual(['--prompt', 'hello world', '--flag']);
    fs.rmSync(dir, { recursive: true });
  });

  it('skips a broken generic.js and warns', () => {
    const dir = makeDir();
    writeGenericJs(dir, 'broken', 'this is not valid javascript }{{{');
    process.env.AT_GENERIC_DIR = dir;

    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() => load()).not.toThrow();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('broken'));
    warnSpy.mockRestore();
    fs.rmSync(dir, { recursive: true });
  });

  it('skips a generic.js missing tier and warns', () => {
    const dir = makeDir();
    writeGenericJs(dir, 'notier', `
      module.exports = {
        bin: () => '/usr/bin/notier',
        buildArgs: (prompt) => [prompt],
      };
    `);
    process.env.AT_GENERIC_DIR = dir;

    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const agents = load();
    expect(agents).toHaveLength(0);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('notier'));
    warnSpy.mockRestore();
    fs.rmSync(dir, { recursive: true });
  });

  it('skips a generic.js missing buildArgs and warns', () => {
    const dir = makeDir();
    writeGenericJs(dir, 'noargs', `
      module.exports = {
        tier: 2,
        bin: () => '/usr/bin/noargs',
      };
    `);
    process.env.AT_GENERIC_DIR = dir;

    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const agents = load();
    expect(agents).toHaveLength(0);
    warnSpy.mockRestore();
    fs.rmSync(dir, { recursive: true });
  });

  it('skips plain files in the base dir (non-directories)', () => {
    const dir = makeDir();
    fs.writeFileSync(path.join(dir, 'somefile.json'), '{}');
    process.env.AT_GENERIC_DIR = dir;

    const agents = load();
    expect(agents).toHaveLength(0);
    fs.rmSync(dir, { recursive: true });
  });

  it('loads optional promptMode and buildEnv from generic.js', () => {
    const dir = makeDir();
    writeGenericJs(dir, 'fancy', `
      module.exports = {
        tier: 2,
        bin: () => '/usr/bin/fancy',
        buildArgs: (prompt) => [prompt],
        promptMode: 'stdin',
        buildEnv: (model) => ({ MODEL: model ?? 'default' }),
      };
    `);
    process.env.AT_GENERIC_DIR = dir;

    const agents = load();
    expect(agents[0].promptMode).toBe('stdin');
    expect(agents[0].buildEnv!('gpt-4')).toEqual({ MODEL: 'gpt-4' });
    fs.rmSync(dir, { recursive: true });
  });
});
