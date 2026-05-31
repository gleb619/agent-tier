import * as fs from 'fs';
import * as path from 'path';
import os from 'os';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resolveStateDir, getStateFilePath, getRunsFilePath, findProjectRoot } from '../src/state-dir';

describe('getStateFilePath', () => {
  it('joins stateDir with state.json', () => {
    expect(getStateFilePath('/home/user/.at')).toBe('/home/user/.at/state.json');
  });
});

describe('getRunsFilePath', () => {
  it('joins stateDir with runs.jsonl', () => {
    expect(getRunsFilePath('/home/user/.at')).toBe('/home/user/.at/runs.jsonl');
  });
});

describe('resolveStateDir', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), `at-state-dir-test-${Date.now()}`);
  });

  afterEach(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('returns explicit path unchanged', () => {
    expect(resolveStateDir('/explicit/path')).toBe('/explicit/path');
    expect(resolveStateDir('/another/path')).toBe('/another/path');
  });

  it('defaults to ~/.at/ when no .at/ in cwd', () => {
    vi.spyOn(process, 'cwd').mockReturnValue(tmpDir);
    expect(resolveStateDir()).toBe(path.join(os.homedir(), '.at'));
  });

  it('detects .at/state.json in cwd and returns it', () => {
    const atDir = path.join(tmpDir, '.at');
    fs.mkdirSync(atDir, { recursive: true });
    fs.writeFileSync(path.join(atDir, 'state.json'), '{}');
    vi.spyOn(process, 'cwd').mockReturnValue(tmpDir);
    expect(resolveStateDir()).toBe(atDir);
  });

  it('detects .at/runs.jsonl in cwd and returns it', () => {
    const atDir = path.join(tmpDir, '.at');
    fs.mkdirSync(atDir, { recursive: true });
    fs.writeFileSync(path.join(atDir, 'runs.jsonl'), '');
    vi.spyOn(process, 'cwd').mockReturnValue(tmpDir);
    expect(resolveStateDir()).toBe(atDir);
  });

  it('detects .at/ in project root when CWD is subdirectory', () => {
    const projectRoot = path.join(os.tmpdir(), `at-project-root-${Date.now()}`);
    const subDir = path.join(projectRoot, 'packages', 'lib');
    const atDir = path.join(projectRoot, '.at');
    fs.mkdirSync(atDir, { recursive: true });
    fs.writeFileSync(path.join(atDir, 'state.json'), '{}');
    fs.mkdirSync(path.join(projectRoot, '.git'), { recursive: true });
    fs.mkdirSync(subDir, { recursive: true });

    vi.spyOn(process, 'cwd').mockReturnValue(subDir);
    expect(resolveStateDir()).toBe(atDir);

    fs.rmSync(projectRoot, { recursive: true, force: true });
  });
});

describe('findProjectRoot', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), `at-find-root-test-${Date.now()}`);
  });

  afterEach(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('returns undefined when no .git found', () => {
    fs.mkdirSync(tmpDir, { recursive: true });
    expect(findProjectRoot(tmpDir)).toBeUndefined();
  });

  it('finds .git in start dir', () => {
    fs.mkdirSync(path.join(tmpDir, '.git'), { recursive: true });
    expect(findProjectRoot(tmpDir)).toBe(tmpDir);
  });

  it('walks up to find .git in parent', () => {
    const subDir = path.join(tmpDir, 'sub', 'dir');
    fs.mkdirSync(path.join(tmpDir, '.git'), { recursive: true });
    fs.mkdirSync(subDir, { recursive: true });
    expect(findProjectRoot(subDir)).toBe(tmpDir);
  });
});