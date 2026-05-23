import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawn, execSync } from 'child_process';
import { writeFileSync, appendFileSync, existsSync, unlinkSync, mkdtempSync } from 'fs';
import path from 'path';
import os from 'os';

const logStreamerJs = path.join(__dirname, '..', 'dist', 'log-streamer.js');

function buildStreamer(): void {
  if (!existsSync(logStreamerJs)) {
    execSync('npm run build', { stdio: 'inherit' });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('log-streamer', () => {
  let tmpDir: string;
  let logFile: string;

  beforeEach(() => {
    buildStreamer();
    tmpDir = mkdtempSync(path.join(os.tmpdir(), 'log-streamer-test-'));
    logFile = path.join(tmpDir, 'test.log');
    writeFileSync(logFile, '');
  });

  afterEach(() => {
    try { unlinkSync(logFile); } catch {}
  });

  it('streams new lines from a log file', async () => {
    const child = spawn('node', [logStreamerJs, '--log', logFile, '--pid', String(process.pid)], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const chunks: string[] = [];
    child.stdout.on('data', (d) => chunks.push(d.toString()));

    await sleep(300);
    appendFileSync(logFile, 'hello world\n');
    await sleep(300);

    const output = chunks.join('');
    expect(output).toContain('hello world');

    child.kill('SIGTERM');
    await sleep(200);
  }, 10000);

  it('drops lines matching built-in patterns', async () => {
    const child = spawn('node', [logStreamerJs, '--log', logFile, '--pid', String(process.pid)], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const chunks: string[] = [];
    child.stdout.on('data', (d) => chunks.push(d.toString()));

    await sleep(300);
    appendFileSync(logFile, 'good line\n');
    appendFileSync(logFile, '\x1b[32mcolored noise\x1b[0m\n');
    appendFileSync(logFile, 'another good line\n');
    await sleep(300);

    const output = chunks.join('');
    expect(output).toContain('good line');
    expect(output).toContain('another good line');
    expect(output).not.toContain('colored noise');

    child.kill('SIGTERM');
    await sleep(200);
  }, 10000);

  it('groups repeated lines', async () => {
    const child = spawn('node', [logStreamerJs, '--log', logFile, '--pid', String(process.pid)], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const chunks: string[] = [];
    child.stdout.on('data', (d) => chunks.push(d.toString()));

    await sleep(300);
    appendFileSync(logFile, 'repeat me\n');
    appendFileSync(logFile, 'repeat me\n');
    appendFileSync(logFile, 'repeat me\n');
    appendFileSync(logFile, 'different\n');
    await sleep(300);

    const output = chunks.join('');
    expect(output).toContain('repeat me');
    expect(output).toContain('different');
    expect(output).toContain('… (3 times)');

    child.kill('SIGTERM');
    await sleep(200);
  }, 10000);

  it('exits when PID is gone and file is stable', async () => {
    const sleeper = spawn('sleep', ['0.3'], { detached: false });
    const sleeperPid = sleeper.pid!;

    const child = spawn('node', [logStreamerJs, '--log', logFile, '--pid', String(sleeperPid)], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const chunks: string[] = [];
    child.stdout.on('data', (d) => chunks.push(d.toString()));

    appendFileSync(logFile, 'before exit\n');
    await sleep(200);

    await new Promise<void>((resolve) => sleeper.on('close', () => resolve()));

    // Wait for streamer to notice PID gone + stable file
    await sleep(2500);

    expect(child.exitCode).toBe(0);
    const output = chunks.join('');
    expect(output).toContain('before exit');
  }, 10000);
});
