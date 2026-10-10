import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Command } from 'commander';
import { mkdtempSync, rmSync, mkdirSync, appendFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { registerEventsCommand } from '../../src/commands/events';
import { appendEvent } from '../../src/notify/store';
import type { NotifyEvent } from '../../src/notify/types';

function makeProgram(): Command {
  const program = new Command();
  program.name('at');
  program.exitOverride();
  registerEventsCommand(program);
  return program;
}

function captureStdout(): { chunks: string[]; restore: () => void } {
  // events.ts calls `console.log`. To capture it we both:
  //  - spy on console.log (which node has cached a reference to via the
  //    global Console object — replacing `process.stdout.write` does NOT
  //    redirect console.log output in node >=18);
  //  - also redirect process.stdout.write for code paths that use it
  //    directly, so we don't miss anything either way.
  const chunks: string[] = [];
  const origWrite = process.stdout.write.bind(process.stdout);
  (process.stdout.write as unknown) = ((s: string | Buffer): boolean => {
    chunks.push(String(s));
    return true;
  });
  const spy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    chunks.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
  });
  return {
    chunks,
    restore: () => {
      spy.mockRestore();
      (process.stdout.write as unknown) = origWrite;
    },
  };
}

function mkEvent(seq: number, type: string, text: string, runId: string): NotifyEvent {
  return {
    runId,
    agent: 'mock',
    ts: new Date().toISOString(),
    seq,
    type,
    text,
  } as NotifyEvent;
}

describe('events command', () => {
  let stateDir: string;
  let runId: string;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stateDir = mkdtempSync(path.join(tmpdir(), 'at-events-'));
    process.env.AT_STATE_DIR = stateDir;
    runId = 'run-events-test';
    mkdirSync(path.join(stateDir, 'events'), { recursive: true });
    exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation(((code?: number) => {
        if (code && code !== 0) throw new Error(`__exit__:${code}`);
        return undefined as never;
      }) as never);
  });

  afterEach(() => {
    rmSync(stateDir, { recursive: true, force: true });
    delete process.env.AT_STATE_DIR;
    exitSpy.mockRestore();
    vi.clearAllMocks();
  });

  it('prints stored events as JSON lines, then returns (no -f)', async () => {
    appendEvent(stateDir, mkEvent(1, 'start', 'started', runId));
    appendEvent(stateDir, mkEvent(2, 'output', 'hello', runId));
    appendEvent(stateDir, mkEvent(3, 'done', 'finished', runId));

    const cap = captureStdout();
    try {
      await makeProgram().parseAsync(['node', 'at', 'events', runId]);
    } finally {
      cap.restore();
    }

    // Debug: ensure spy was actually called 3 times
    // Each chunk is one console.log call (a single JSON string). console.log
    // appends '\n' to stdout but our mock does not, so split chunks
    // directly instead of join-then-split.
    expect(cap.chunks).toHaveLength(3);
    const parsed = cap.chunks.map((l) => JSON.parse(l));
    expect(parsed.map((e: NotifyEvent) => e.seq)).toEqual([1, 2, 3]);
    expect(parsed.map((e: NotifyEvent) => e.type)).toEqual(['start', 'output', 'done']);
  });

  it('prints nothing when no events exist', async () => {
    const cap = captureStdout();
    try {
      await makeProgram().parseAsync(['node', 'at', 'events', runId]);
    } finally {
      cap.restore();
    }
    expect(cap.chunks.join('').trim()).toBe('');
  });

  // ── -f follow ───────────────────────────────────────────────────────────
  // NOTE: events.ts -f currently returns immediately after registering the
  // polling interval + signal handlers (it does not `await` the signal). That
  // means parseAsync resolves before any signal fires. The tests below keep
  // the test process alive long enough for the interval polls + signal
  // handlers to run. This bug is documented in the task report.

  it('with -f, registers SIGINT + SIGTERM handlers and exits 0 on SIGINT', async () => {
    appendEvent(stateDir, mkEvent(1, 'start', 'started', runId));
    const cap = captureStdout();

    await makeProgram().parseAsync(['node', 'at', 'events', runId, '-f']);

    // The action returned, but setInterval keeps the event loop pumping and
    // signal handlers stay registered. Verify both handlers exist.
    expect(process.listeners('SIGINT').length).toBeGreaterThan(0);
    expect(process.listeners('SIGTERM').length).toBeGreaterThan(0);

    // Append a follow-up event; the next 500ms poll should pick it up.
    setTimeout(() => appendEvent(stateDir, mkEvent(2, 'output', 'followup', runId)), 100);
    // Fire SIGINT after the poll has had a chance to pick up the event.
    setTimeout(() => process.kill(process.pid, 'SIGINT'), 800);

    await new Promise((r) => setTimeout(r, 1200));

    expect(cap.chunks.length).toBeGreaterThanOrEqual(2);
    const seqs = cap.chunks.map((l) => JSON.parse(l).seq);
    expect(seqs).toContain(1);
    expect(seqs).toContain(2);
    expect(exitSpy).toHaveBeenCalledWith(0);

    cap.restore();
  });

  it('with -f, SIGTERM also exits 0', async () => {
    appendEvent(stateDir, mkEvent(1, 'start', 'started', runId));
    const cap = captureStdout();

    await makeProgram().parseAsync(['node', 'at', 'events', runId, '-f']);
    expect(process.listeners('SIGTERM').length).toBeGreaterThan(0);

    setTimeout(() => process.kill(process.pid, 'SIGTERM'), 400);
    await new Promise((r) => setTimeout(r, 700));

    expect(exitSpy).toHaveBeenCalledWith(0);

    cap.restore();
  });

  it('reads from the alt state dir via AT_STATE_DIR env override', async () => {
    // events.ts reads stateDir via resolveStateDir(), which prefers AT_STATE_DIR.
    // Verify the env override actually drives the file lookup.
    const altState = mkdtempSync(path.join(tmpdir(), 'at-events-alt-'));
    try {
      mkdirSync(path.join(altState, 'events'), { recursive: true });
      const event = mkEvent(1, 'start', 'from-alt', runId);
      appendFileSync(
        path.join(altState, 'events', `${runId}.jsonl`),
        JSON.stringify(event) + '\n',
      );

      const prevState = process.env.AT_STATE_DIR;
      process.env.AT_STATE_DIR = altState;
      try {
        const cap = captureStdout();
        try {
          await makeProgram().parseAsync(['node', 'at', 'events', runId]);
        } finally {
          cap.restore();
        }

        const lines = cap.chunks;
        expect(lines).toHaveLength(1);
        const parsed = JSON.parse(lines[0]);
        expect(parsed.text).toBe('from-alt');
      } finally {
        process.env.AT_STATE_DIR = prevState;
      }
    } finally {
      rmSync(altState, { recursive: true, force: true });
    }
  });
});