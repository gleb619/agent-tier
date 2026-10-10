import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync, unlinkSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const binDir = path.resolve(here, '..', '..', 'bin');
const mockBin = path.join(binDir, 'mock-agent');
const mockLongBin = path.join(binDir, 'mock-long-agent');
const repoRoot = path.resolve(here, '..', '..');

function build(): void {
  const r = spawnSync('make', ['build'], { cwd: repoRoot, stdio: 'inherit' });
  if (r.status !== 0) throw new Error('make build failed');
}

beforeAll(() => {
  build();
}, 120_000);

describe('normka e2e (mock-agent binary)', () => {
  it('legacy path echoes prompt', () => {
    const r = spawnSync(mockBin, ['hello'], { encoding: 'utf8' });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('[mock] received prompt: hello');
  });

  it('--normka with empty steps exits 0', () => {
    const r = spawnSync(mockBin, ['--normka', '{"version":1,"steps":[]}'], { encoding: 'utf8' });
    expect(r.status).toBe(0);
  });

  it('--normka with bad JSON exits 3', () => {
    const r = spawnSync(mockBin, ['--normka', 'not-json'], { encoding: 'utf8' });
    expect(r.status).toBe(3);
  });

  it('file step writes a temp file', () => {
    const p = `/tmp/normka-e2e-${process.pid}-${Date.now()}.txt`;
    const spec = JSON.stringify({ version: 1, steps: [{ kind: 'file', path: p, content: 'x' }] });
    const r = spawnSync(mockBin, ['--normka', spec], { encoding: 'utf8' });
    expect(r.status).toBe(0);
    expect(existsSync(p)).toBe(true);
    expect(readFileSync(p, 'utf8')).toBe('x');
    unlinkSync(p);
  });

  it('unknown kind exits 3', () => {
    const spec = JSON.stringify({ version: 1, steps: [{ kind: 'no-such-kind' }] });
    const r = spawnSync(mockBin, ['--normka', spec], { encoding: 'utf8' });
    expect(r.status).toBe(3);
  });

  it('hash directive triggers normka (no flag)', () => {
    const p = `/tmp/normka-e2e-hash-${process.pid}-${Date.now()}.txt`;
    const spec = JSON.stringify({ version: 1, steps: [{ kind: 'file', path: p, content: 'h' }] });
    // Pipe the prompt via stdin so the real newline before the JSON survives.
    const prompt = `#NORMKA\n${spec}\n`;
    const r = spawnSync(mockBin, [], { encoding: 'utf8', input: prompt });
    expect(r.status).toBe(0);
    expect(existsSync(p)).toBe(true);
    unlinkSync(p);
  });

  it('safe-path rejections honour spec', () => {
    const spec = JSON.stringify({ version: 1, steps: [{ kind: 'file', path: '/etc/passwd', content: 'x' }] });
    const r = spawnSync(mockBin, ['--normka', spec], { encoding: 'utf8' });
    expect(r.status).toBe(3);
    expect(r.stderr).toMatch(/unsafe path/);
  });
});

describe('normka e2e (mock-long-agent binary)', () => {
  it('legacy stream tick visible', () => {
    const r = spawnSync('bash', ['-c', `MOCK_LONG_DURATION=120 ${mockLongBin} hi 2>&1 | head -3`], {
      encoding: 'utf8',
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/mock-long.*starting/);
  }, 15_000);

  it('normka with lorem step exits 0', () => {
    const r = spawnSync(mockLongBin, ['--normka', '{"version":1,"steps":[{"kind":"lorem","paragraphs":1}]}'], {
      encoding: 'utf8',
    });
    expect(r.status).toBe(0);
  }, 15_000);
});

afterAll(() => {
  // no-op: temp files cleaned in their it() blocks
});
