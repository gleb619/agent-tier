import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { computeHmac } from '../src/config';
import { setDeactivated, isDeactivated } from '../src/health';
import { runStatus } from '../src/status';
import { runInit, formatInitResults } from '../src/init';
import { getRunsFile } from '../src/run-store';

function mkdtemp(): string {
  const d = path.join(os.tmpdir(), `at-test-${Date.now()}-${Math.random()}`);
  fs.mkdirSync(d, { recursive: true });
  return d;
}

describe('signConfig', () => {
  // signConfig reads hardcoded CONFIG_FILE (~/.at/config.json),
  // so we test computeHmac directly and skip the full signConfig
  // (which writes to ~/.at/config.json.hmac). Integration test.

  it('computeHmac returns 64-char hex', () => {
    const hmac = computeHmac('{"tierOverrides":{}}');
    expect(hmac.length).toBe(64);
    expect(/^[a-f0-9]+$/.test(hmac)).toBe(true);
  });

  it('computeHmac is deterministic', () => {
    const data = '{"tierOverrides":{"kimi":1}}';
    expect(computeHmac(data)).toBe(computeHmac(data));
  });

  it('computeHmac differs for different inputs', () => {
    expect(computeHmac('a')).not.toBe(computeHmac('b'));
  });
});

describe('isDeactivated / setDeactivated', () => {
  let tmpDir: string;
  let stateFile: string;

  beforeEach(() => {
    tmpDir = mkdtemp();
    stateFile = path.join(tmpDir, 'state.json');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('isDeactivated returns false when no state', async () => {
    const result = await isDeactivated(stateFile, 'pi');
    expect(result).toBe(false);
  });

  it('setDeactivated(true) creates state with deactivated flag', async () => {
    await setDeactivated(stateFile, 'pi', true);
    const result = await isDeactivated(stateFile, 'pi');
    expect(result).toBe(true);
  });

  it('setDeactivated(false) removes the flag', async () => {
    await setDeactivated(stateFile, 'pi', true);
    await setDeactivated(stateFile, 'pi', false);
    const result = await isDeactivated(stateFile, 'pi');
    expect(result).toBe(false);
  });
});

describe('runStatus + formatInitResults', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtemp();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('runStatus: writes "no runs found" when runs.jsonl empty', () => {
    fs.writeFileSync(getRunsFile(tmpDir), '', 'utf8');
    let output = '';
    const orig = console.log;
    console.log = (...a: unknown[]) => { output += a.join(' ') + '\n'; };
    try { runStatus(tmpDir); } finally { console.log = orig; }
    expect(output).toContain('no runs found');
  });

  it('runStatus: outputs JSON when json:true', () => {
    fs.writeFileSync(getRunsFile(tmpDir), '', 'utf8');
    let output = '';
    const orig = process.stdout.write;
    process.stdout.write = (s) => { output += s; return true; };
    try { runStatus(tmpDir, { json: true }); } finally { process.stdout.write = orig; }
    expect(JSON.parse(output.trim())).toHaveProperty('runs');
  });

  it('formatInitResults: CREATED / SKIP / WOULD CREATE', () => {
    const out = formatInitResults([
      { agent: 'x', targetPath: '/x', action: 'created' as const },
      { agent: 'y', targetPath: '/y', action: 'skipped' as const, reason: 'exists' },
      { agent: 'z', targetPath: '/z', action: 'would_create' as const },
    ]);
    expect(out).toContain('CREATED');
    expect(out).toContain('SKIP');
    expect(out).toContain('WOULD CREATE');
    expect(out).toContain('exists');
  });
});

describe('runInit', () => {
  it('list returns array of InitResult', () => {
    const results = runInit({ list: true });
    expect(Array.isArray(results)).toBe(true);
    results.forEach(r => expect(typeof r.agent).toBe('string'));
  });

  it('throws for non-existent agent', () => {
    expect(() => runInit({ agent: 'nonexistent-agent-xyz' })).toThrow();
  });
});