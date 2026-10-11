import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..');
const SCRIPT = join(ROOT, 'scripts', 'ci-check.sh');
const WORKFLOW = join(ROOT, '.github', 'workflows', 'ci.yml');
const PKG = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

function runScript(args: string[]): { status: number; out: string } {
  try {
    const out = execFileSync('bash', [SCRIPT, ...args], {
      encoding: 'utf8',
      cwd: ROOT,
      env: { ...process.env, AT_STATE_DIR: '/tmp/at-ci-check-test-state' },
    });
    return { status: 0, out };
  } catch (err: any) {
    return { status: err.status ?? 1, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
}

describe('ci-check script', () => {
  it('exists and is executable', () => {
    expect(existsSync(SCRIPT)).toBe(true);
    const mode = execFileSync('stat', ['-c', '%a', SCRIPT], { encoding: 'utf8' }).trim();
    expect(Number(mode) % 2).toBe(1); // owner-exec bit set
  });

  it('passes bash -n syntax check', () => {
    expect(() => execFileSync('bash', ['-n', SCRIPT])).not.toThrow();
  });

  it('rejects unknown options with exit code 2', () => {
    const res = runScript(['--bogus']);
    expect(res.status).toBe(2);
  });
});

describe('ci workflow file', () => {
  const wf = readFileSync(WORKFLOW, 'utf8');

  it('exists', () => {
    expect(existsSync(WORKFLOW)).toBe(true);
  });

  it('has a name and triggers on push/PR to main', () => {
    expect(wf).toMatch(/^name:/m);
    expect(wf).toMatch(/pull_request:/);
    expect(wf).toMatch(/branches:\s*\[main\]/);
  });

  it('defines build and publish jobs', () => {
    expect(wf).toMatch(/^\s{2}build:/m);
    expect(wf).toMatch(/^\s{2}publish:/m);
  });

  it('build job runs npm ci and npm run build', () => {
    expect(wf).toMatch(/npm ci/);
    expect(wf).toMatch(/npm run build/);
  });
});

describe('wrkflw dry-run (skipped when wrkflw not installed)', () => {
  const hasWrkflw = (() => {
    try {
      execFileSync('wrkflw', ['--help'], { stdio: 'pipe' });
      return true;
    } catch {
      return false;
    }
  })();

  it('validates .github/workflows/ci.yml', { skip: !hasWrkflw ? 'wrkflw not installed' : undefined } as any, () => {
    const res = runScript(['--skip-docker']);
    expect(res.status).toBe(0);
    expect(res.out).toContain('OK: workflow valid');
  });
});

describe('package.json wiring', () => {
  it('exposes ci:check script pointing at the checker', () => {
    expect(PKG.scripts['ci:check']).toBe('bash scripts/ci-check.sh');
  });
});
