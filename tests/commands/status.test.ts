import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Command } from 'commander';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { registerStatusCommand } from '../../src/commands/status';
import { registerDefaultCommand } from '../../src/commands/default';
import { RunRecord } from '../../src/run-store';

// Unit-level: register the status command alongside the default command
// (which also defines a `--json` option at the program root) and confirm
// that `status --json` emits JSON, not markdown.
describe('registerStatusCommand --json', () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'at-status-cmd-'));
    fs.writeFileSync(
      path.join(tmpDir, 'runs.jsonl'),
      JSON.stringify({
        runId: 'abc123',
        agent: 'mock',
        tier: 4,
        pid: 1,
        prompt: 'p',
        logFile: '/tmp/x.log',
        startedAt: new Date().toISOString(),
        finishedAt: null,
        exitCode: null,
        status: 'running',
        name: 'unnamed',
      } satisfies RunRecord) + '\n',
    );
    fs.writeFileSync(path.join(tmpDir, 'state.json'), '{"scheduler":{}}');
    process.env.AT_STATE_DIR = tmpDir;
  });

  afterAll(() => {
    delete process.env.AT_STATE_DIR;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function runRegistered(args: string[]): string {
    const program = new Command();
    program.exitOverride(); // throw on unknown args instead of process.exit
    // Order matters: register the default command first so it injects a
    // program-level `--json` option, then register the status command which
    // also defines `--json` on the subcommand.
    registerDefaultCommand(program);
    registerStatusCommand(program);

    const stdoutChunks: string[] = [];
    const origWrite = process.stdout.write.bind(process.stdout);
    const origLog = console.log.bind(console);
    (process.stdout.write as unknown) = (chunk: string | Buffer): boolean => {
      stdoutChunks.push(typeof chunk === 'string' ? chunk : chunk.toString());
      return true;
    };
    console.log = (...parts: unknown[]) => {
      stdoutChunks.push(parts.map((p) => (typeof p === 'string' ? p : String(p))).join(' '));
    };

    try {
      // parseAsync because registerDefaultCommand registers an async action.
      const result = program.parseAsync(['node', 'at', ...args]);
      // The default action is async but shouldn't fire for `status`; if it
      // does, swallow the rejection from exitOverride.
      return Promise.resolve(result)
        .catch(() => undefined)
        .then(() => {
          (process.stdout.write as unknown) = origWrite;
          console.log = origLog;
          return stdoutChunks.join('');
        });
    } catch {
      (process.stdout.write as unknown) = origWrite;
      console.log = origLog;
      return stdoutChunks.join('');
    }
  }

  it('emits JSON when --json is passed', async () => {
    const out = await runRegistered(['status', '--json']);
    expect(() => JSON.parse(out)).not.toThrow();
    const parsed = JSON.parse(out);
    expect(parsed).toHaveProperty('total');
    expect(parsed).toHaveProperty('runs');
    expect(Array.isArray(parsed.runs)).toBe(true);
  });

  it('does NOT emit markdown when --json is passed', async () => {
    const out = await runRegistered(['status', '--json']);
    expect(out).not.toContain('# Runs');
    expect(out).not.toContain('## State');
  });

  it('emits markdown when --json is NOT passed', async () => {
    const out = await runRegistered(['status']);
    expect(out).toContain('# Runs');
  });
});

// End-to-end: spawn the built CLI binary and confirm `--json` produces JSON.
// This catches the exact bug the user reported: `at status --json` returning
// markdown instead of JSON.
describe('at status --json (e2e)', () => {
  let tmpDir: string;
  let cliPath: string;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'at-status-e2e-'));
    fs.writeFileSync(path.join(tmpDir, 'state.json'), '{"scheduler":{}}');
    fs.writeFileSync(path.join(tmpDir, 'runs.jsonl'), '');

    // Find the built CLI: tests run from the repo root via vitest.
    cliPath = path.resolve(__dirname, '..', '..', 'dist', 'cli.js');
    if (!fs.existsSync(cliPath)) {
      throw new Error(`dist/cli.js not found at ${cliPath} — run \`npm run build\` first`);
    }
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('prints JSON to stdout', async () => {
    const { stdout } = await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
      const child = spawn(process.execPath, [cliPath, 'status', '--json'], {
        env: { ...process.env, AT_STATE_DIR: tmpDir },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let out = '';
      let err = '';
      child.stdout.on('data', (b) => (out += b.toString()));
      child.stderr.on('data', (b) => (err += b.toString()));
      child.on('error', reject);
      child.on('close', () => resolve({ stdout: out, stderr: err }));
    });

    expect(() => JSON.parse(stdout)).not.toThrow();
    const parsed = JSON.parse(stdout);
    expect(parsed).toHaveProperty('total');
    expect(parsed).toHaveProperty('runs');
    expect(stdout).not.toContain('# Runs');
    expect(stdout).not.toContain('## State');
  });
});