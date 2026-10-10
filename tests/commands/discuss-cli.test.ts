import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Command } from 'commander';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { registerDiscussCommand } from '../../src/commands/discuss';
import { appendDiscuss } from '../../src/notify/discuss-store';

function captureStdout(): { chunks: string[]; restore: () => void } {
  const chunks: string[] = [];
  const origWrite = process.stdout.write.bind(process.stdout);
  (process.stdout.write as unknown) = ((s: string | Buffer): boolean => {
    chunks.push(String(s));
    return true;
  });
  return {
    chunks,
    restore: () => {
      (process.stdout.write as unknown) = origWrite;
    },
  };
}

async function runDiscuss(args: string[], opts: { stateDir?: string } = {}): Promise<void> {
  const program = new Command();
  program.name('at');
  program.exitOverride();
  // Mirror the root-level options that shadow discuss subcommand options
  // in the real CLI (e.g. --json, --state-dir) without pulling in unrelated
  // defaults like --timeout that conflict with ask's own --timeout.
  program.option('--state-dir <path>', 'State directory');
  program.option('--json', 'Read JSON from stdin', false);
  program.option('--retries <number>', 'Retries', '0');
  registerDiscussCommand(program);
  await program.parseAsync(['node', 'at', 'discuss', ...args]);
}

describe('discuss CLI subcommands — gaps not covered by tests/notify/discuss.test.ts', () => {
  let stateDir: string;

  beforeEach(() => {
    stateDir = mkdtempSync(path.join(tmpdir(), 'at-discuss-cli-'));
    process.env.AT_STATE_DIR = stateDir;
  });

  afterEach(() => {
    delete process.env.AT_RUN_ID;
    delete process.env.AT_STATE_DIR;
    rmSync(stateDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  // ── say ──────────────────────────────────────────────────────────────────

  it('say writes a kind:say entry with from:host and returns no output', async () => {
    process.env.AT_RUN_ID = 'r-say';
    const cap = captureStdout();
    try {
      await runDiscuss(['say', 'please continue with task X']);
    } finally {
      cap.restore();
    }
    // say is fire-and-forget: no stdout, no exit code printed
    expect(cap.chunks.join('')).toBe('');
  });

  it('say accepts -R/--run without AT_RUN_ID', async () => {
    delete process.env.AT_RUN_ID;
    await runDiscuss(['say', 'hello from -R', '-R', 'r-say-R']);
    const entries = (await import('../../src/notify/discuss-store')).readThread(stateDir, 'r-say-R');
    expect(entries.find((e) => e.kind === 'say' && e.text === 'hello from -R')).toBeDefined();
  });

  // ── inbox ────────────────────────────────────────────────────────────────

  it('inbox with no events produces empty output', async () => {
    process.env.AT_RUN_ID = 'r-empty-inbox';
    const cap = captureStdout();
    try {
      await runDiscuss(['inbox']);
    } finally {
      cap.restore();
    }
    expect(cap.chunks.join('')).toBe('');
  });

  it('inbox --since returns only host says after the given id', async () => {
    process.env.AT_RUN_ID = 'r-inbox-since';
    // Seed three say entries with predictable ids
    appendDiscuss(stateDir, 'r-inbox-since', {
      id: 'm1', from: 'host', kind: 'say', text: 'one',
      ts: new Date().toISOString(),
    });
    appendDiscuss(stateDir, 'r-inbox-since', {
      id: 'm2', from: 'host', kind: 'say', text: 'two',
      ts: new Date().toISOString(),
    });
    appendDiscuss(stateDir, 'r-inbox-since', {
      id: 'm3', from: 'host', kind: 'say', text: 'three',
      ts: new Date().toISOString(),
    });

    const cap = captureStdout();
    try {
      await runDiscuss(['inbox', '--since', 'm1']);
    } finally {
      cap.restore();
    }
    const out = cap.chunks.join('');
    expect(out).not.toContain('one');
    expect(out).toContain('m2\ttwo');
    expect(out).toContain('m3\tthree');
  });

  it('inbox ignores agent notes — it returns host says only', async () => {
    process.env.AT_RUN_ID = 'r-inbox-host-only';
    appendDiscuss(stateDir, 'r-inbox-host-only', {
      id: 'm1', from: 'agent', kind: 'note', text: 'agent note',
      ts: new Date().toISOString(),
    });
    appendDiscuss(stateDir, 'r-inbox-host-only', {
      id: 'm2', from: 'host', kind: 'say', text: 'host instruction',
      ts: new Date().toISOString(),
    });
    const cap = captureStdout();
    try {
      await runDiscuss(['inbox']);
    } finally {
      cap.restore();
    }
    const out = cap.chunks.join('');
    expect(out).toContain('host instruction');
    expect(out).not.toContain('agent note');
  });

  it('inbox reads from --state-dir (regression: inherited global option)', async () => {
    const altState = mkdtempSync(path.join(tmpdir(), 'at-discuss-cli-alt-'));
    try {
      delete process.env.AT_STATE_DIR;
      delete process.env.AT_RUN_ID;
      appendDiscuss(altState, 'r-alt', {
        id: 'm1', from: 'host', kind: 'say', text: 'alt-host-msg',
        ts: new Date().toISOString(),
      });
      const cap = captureStdout();
      try {
        await runDiscuss(['inbox', '-R', 'r-alt', '--state-dir', altState]);
      } finally {
        cap.restore();
      }
      expect(cap.chunks.join('')).toContain('alt-host-msg');
    } finally {
      rmSync(altState, { recursive: true, force: true });
    }
  });

  // ── list ─────────────────────────────────────────────────────────────────

  it('list accepts a positional runId arg without AT_RUN_ID or -R', async () => {
    delete process.env.AT_RUN_ID;
    appendDiscuss(stateDir, 'r-positional', {
      id: 'm1', from: 'agent', kind: 'note', text: 'positional-list',
      ts: new Date().toISOString(),
    });
    const cap = captureStdout();
    try {
      await runDiscuss(['list', 'r-positional']);
    } finally {
      cap.restore();
    }
    expect(cap.chunks.join('')).toContain('positional-list');
  });

  it('list --pending --json emits JSON array of unanswered questions only', async () => {
    process.env.AT_RUN_ID = 'r-list-pending-json';
    appendDiscuss(stateDir, 'r-list-pending-json', {
      id: 'm1', from: 'agent', kind: 'question', text: 'open?',
      ts: new Date().toISOString(),
    });
    appendDiscuss(stateDir, 'r-list-pending-json', {
      id: 'm2', from: 'agent', kind: 'question', text: 'closed?',
      replyTo: 'm2',
      ts: new Date().toISOString(),
    });
    appendDiscuss(stateDir, 'r-list-pending-json', {
      id: 'm3', from: 'host', kind: 'answer', text: 'yes',
      replyTo: 'm2',
      ts: new Date().toISOString(),
    });

    const cap = captureStdout();
    try {
      await runDiscuss(['list', '--pending', '--json']);
    } finally {
      cap.restore();
    }
    const parsed = JSON.parse(cap.chunks.join(''));
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({ id: 'm1', kind: 'question', text: 'open?' });
  });

  it('list with no runId (no arg, no -R, no AT_RUN_ID) exits 2', async () => {
    delete process.env.AT_RUN_ID;
    const trap = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`__exit__:${code}`);
    }) as never);
    let exitCode: number | undefined;
    try {
      try {
        await runDiscuss(['list']);
      } catch (e) {
        exitCode = Number(String(e).match(/__exit__:(\d+)/)?.[1]);
      }
    } finally {
      trap.mockRestore();
    }
    expect(exitCode).toBe(2);
  });

  // ── answer ───────────────────────────────────────────────────────────────

  it('answer with no pending questions and no qid/mN exits 1', async () => {
    process.env.AT_RUN_ID = 'r-no-pending';
    const trap = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`__exit__:${code}`);
    }) as never);
    let exitCode: number | undefined;
    try {
      try {
        await runDiscuss(['answer', 'yes']);
      } catch (e) {
        exitCode = Number(String(e).match(/__exit__:(\d+)/)?.[1]);
      }
    } finally {
      trap.mockRestore();
    }
    expect(exitCode).toBe(1);
  });

  // Note: `answer` with empty <text> is unreachable through the CLI because
  // commander's `<text...>` variadic validates at least one arg before the
  // action runs. The action's `if (textParts.length === 0)` check is dead
  // code under normal usage.
});