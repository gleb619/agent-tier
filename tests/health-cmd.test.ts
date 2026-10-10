/**
 * Regression: 'at enable <name>' and 'at disable <name>' must reject
 * unknown agent names with exit 1 and an error message.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { spawnSync, execSync } from 'child_process';
import { mkdirSync, writeFileSync, mkdtempSync, rmSync, readFileSync } from 'fs';
import path from 'path';
import os from 'os';

const cliPath = path.join(__dirname, '..', 'dist', 'cli.js');

function buildCli(): void {
  execSync('npm run build', { stdio: 'inherit' });
}

function runCli(args: string[], env: Record<string, string>): { exitCode: number; stdout: string; stderr: string } {
  const result = spawnSync('node', [cliPath, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
  return {
    exitCode: result.status ?? -1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

function seedStateDir(stateDir: string): void {
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(path.join(stateDir, 'state.json'), '{}', 'utf8');
}

describe('at enable / disable — unknown agent', () => {
  beforeAll(() => {
    buildCli();
  }, 60000);

  it('enable foo (unknown) prints error and exits 1', () => {
    const stateDir = mkdtempSync(path.join(os.tmpdir(), 'at-enable-unknown-'));
    seedStateDir(stateDir);
    try {
      const r = runCli(['enable', 'foo'], { AT_STATE_DIR: stateDir });
      expect(r.exitCode).toBe(1);
      const out = r.stdout + r.stderr;
      expect(out).toContain('[at] error: Unknown agent: foo');
    } finally {
      rmSync(stateDir, { recursive: true, force: true });
    }
  });

  it('disable foo (unknown) prints error and exits 1', () => {
    const stateDir = mkdtempSync(path.join(os.tmpdir(), 'at-disable-unknown-'));
    seedStateDir(stateDir);
    try {
      const r = runCli(['disable', 'foo'], { AT_STATE_DIR: stateDir });
      expect(r.exitCode).toBe(1);
      const out = r.stdout + r.stderr;
      expect(out).toContain('[at] error: Unknown agent: foo');
    } finally {
      rmSync(stateDir, { recursive: true, force: true });
    }
  });

  it('enable opencode (valid) succeeds', () => {
    const stateDir = mkdtempSync(path.join(os.tmpdir(), 'at-enable-valid-'));
    seedStateDir(stateDir);
    try {
      const r = runCli(['enable', 'opencode'], { AT_STATE_DIR: stateDir });
      expect(r.exitCode).toBe(0);
      const out = r.stdout + r.stderr;
      expect(out).toContain('enabled');
      const state = JSON.parse(readFileSync(path.join(stateDir, 'state.json'), 'utf8')) as {
        agents?: Record<string, { deactivated?: boolean }>;
      };
      // enable clears the deactivated flag (deletes the key per setDeactivated(false))
      expect(state.agents?.opencode?.deactivated).not.toBe(true);
    } finally {
      rmSync(stateDir, { recursive: true, force: true });
    }
  });

  it('disable mm-code (valid) succeeds and writes deactivated=true', () => {
    const stateDir = mkdtempSync(path.join(os.tmpdir(), 'at-disable-valid-'));
    seedStateDir(stateDir);
    try {
      const r = runCli(['disable', 'mm-code'], { AT_STATE_DIR: stateDir });
      expect(r.exitCode).toBe(0);
      const out = r.stdout + r.stderr;
      expect(out).toContain('deactivated');
      const state = JSON.parse(readFileSync(path.join(stateDir, 'state.json'), 'utf8')) as {
        agents?: Record<string, { deactivated?: boolean }>;
      };
      expect(state.agents?.['mm-code']?.deactivated).toBe(true);
    } finally {
      rmSync(stateDir, { recursive: true, force: true });
    }
  });

  it('enable with another bogus name also rejected', () => {
    const stateDir = mkdtempSync(path.join(os.tmpdir(), 'at-enable-bogus-'));
    seedStateDir(stateDir);
    try {
      const r = runCli(['enable', 'totally-bogus-agent-xyz'], { AT_STATE_DIR: stateDir });
      expect(r.exitCode).toBe(1);
      const out = r.stdout + r.stderr;
      expect(out).toContain('Unknown agent: totally-bogus-agent-xyz');
    } finally {
      rmSync(stateDir, { recursive: true, force: true });
    }
  });
});
