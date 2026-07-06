import { describe, it, expect, beforeAll } from 'vitest';
import { spawnSync, execSync } from 'child_process';
import { readFileSync, readdirSync } from 'fs';
import path from 'path';
import os from 'os';
import { mkdtempSync } from 'fs';

const cliPath = path.join(__dirname, '..', 'dist', 'cli.js');

function buildCli(): void {
  execSync('npm run build', { stdio: 'inherit' });
}

function runCli(args: string[], stdinData?: string): { exitCode: number; stdout: string; stderr: string } {
  const result = spawnSync('node', [cliPath, ...args], {
    input: stdinData,
    encoding: 'utf8',
    cwd: process.cwd(),
  });
  return {
    exitCode: result.status ?? -1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

function waitForLogFile(logDir: string, agentName: string, timeoutMs = 5000): string | null {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const files = readdirSync(logDir).filter((f) => f.includes(`-${agentName}.log`));
    if (files.length > 0) {
      return path.join(logDir, files.sort().at(-1)!);
    }
    // sleep a bit before retrying
    const start = Date.now();
    while (Date.now() - start < 100) { /* spin */ }
  }
  return null;
}

describe('stdin pipe mode', () => {
  beforeAll(() => {
    buildCli();
  }, 60000);

  it('reads prompt from piped stdin when no -p flag', async () => {
    const logDir = mkdtempSync(path.join(os.tmpdir(), 'at-stdin-test-'));
    const result = runCli(['-a', 'mock', '--log-dir', logDir], 'hello from stdin');
    expect(result.exitCode).toBe(0);

    const logFile = waitForLogFile(logDir, 'mock');
    expect(logFile).not.toBeNull();
    const content = readFileSync(logFile!, 'utf8');
    expect(content).toContain('hello from stdin');
  });

  it('explicit -p flag takes precedence over stdin', async () => {
    const logDir = mkdtempSync(path.join(os.tmpdir(), 'at-stdin-test-'));
    const result = runCli(['-a', 'mock', '--log-dir', logDir, '-p', 'explicit prompt'], 'ignored');
    expect(result.exitCode).toBe(0);

    const logFile = waitForLogFile(logDir, 'mock');
    expect(logFile).not.toBeNull();
    const content = readFileSync(logFile!, 'utf8');
    expect(content).toContain('explicit prompt');
    expect(content).not.toContain('ignored');
  });

  it('no-arg invocation with piped stdin does NOT launch TUI', () => {
    const result = runCli(['-a', 'mock', '-s'], 'prompt');
    const output = result.stdout + result.stderr;
    expect(result.exitCode).toBe(0);
    expect(output).not.toContain('TUI requires Bun');
  });
});

describe('--json stdin mode', () => {
  beforeAll(() => {
    buildCli();
  }, 60000);

  it('reads JSON object from stdin and extracts prompt', async () => {
    const logDir = mkdtempSync(path.join(os.tmpdir(), 'at-stdin-test-'));
    const result = runCli(['--json', '--log-dir', logDir], JSON.stringify({ prompt: 'json prompt', agent: 'mock' }));
    expect(result.exitCode).toBe(0);

    const logFile = waitForLogFile(logDir, 'mock');
    expect(logFile).not.toBeNull();
    const content = readFileSync(logFile!, 'utf8');
    expect(content).toContain('json prompt');
  });

  it('throws on invalid JSON', () => {
    const result = runCli(['--json'], 'not json');
    expect(result.exitCode).not.toBe(0);
    expect(result.stdout + result.stderr).toContain('error');
  });

  it('throws when JSON missing prompt', () => {
    const result = runCli(['--json'], '{"agent":"mock"}');
    expect(result.exitCode).not.toBe(0);
    expect(result.stdout + result.stderr).toContain('error');
  });
});

describe('--callback flag', () => {
  beforeAll(() => {
    buildCli();
  }, 60000);

  it('runs callback after agent exits in stream mode', async () => {
    const markerFile = path.join(os.tmpdir(), `at-callback-cli-${Date.now()}.txt`);
    const result = runCli([
      '-a', 'mock',
      '-s',
      '-p', 'callback test',
      '--callback', `sh -c 'echo "status=$AT_STATUS agent=$AT_AGENT" > ${markerFile}'`,
    ]);
    expect(result.exitCode).toBe(0);
    const content = readFileSync(markerFile, 'utf8').trim();
    expect(content).toContain('status=done');
    expect(content).toContain('agent=mock');
  });

  it('runs callback from JSON input', async () => {
    const markerFile = path.join(os.tmpdir(), `at-callback-json-${Date.now()}.txt`);
    const result = runCli(
      ['--json'],
      JSON.stringify({
        prompt: 'json callback test',
        agent: 'mock',
        callback: `sh -c 'echo "json-status=$AT_STATUS" > ${markerFile}'`,
      }),
    );
    expect(result.exitCode).toBe(0);
    await new Promise((resolve) => setTimeout(resolve, 500));
    const content = readFileSync(markerFile, 'utf8').trim();
    expect(content).toContain('json-status=done');
  });
});
