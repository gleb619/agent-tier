import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Command } from 'commander';
import { mkdtempSync, rmSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { registerNotifyCommand } from '../../src/commands/notify';
import { startHub } from '../../src/notify/hub';

describe('at notify command', () => {
  let tmp: string;
  let stateDir: string;
  let hub: Awaited<ReturnType<typeof startHub>> | undefined;
  const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

  beforeEach(() => {
    tmp = mkdtempSync(path.join(tmpdir(), 'at-notify-cmd-'));
    stateDir = tmp;
    exitSpy.mockClear();
  });

  afterEach(async () => {
    await hub?.close();
    delete process.env.AT_SSE_URL;
    delete process.env.AT_EVENT_FILE;
    rmSync(tmp, { recursive: true, force: true });
  });

  async function runNotify(args: string[]): Promise<void> {
    const program = new Command();
    registerNotifyCommand(program);
    await program.parseAsync(['node', 'at', 'notify', ...args]);
  }

  it('falls back to append event file when AT_SSE_URL missing', async () => {
    const eventFile = path.join(stateDir, 'events', 'run-x.jsonl');
    process.env.AT_EVENT_FILE = eventFile;
    await runNotify(['run-x', 'hello', 'world']);
    const lines = readFileSync(eventFile, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(1);
    const ev = JSON.parse(lines[0]);
    expect(ev.type).toBe('message');
    expect(ev.text).toBe('hello world');
    expect(ev.runId).toBe('run-x');
  });

  it('POSTs to hub when AT_SSE_URL set', async () => {
    hub = await startHub({ stateDir, port: 0 });
    process.env.AT_SSE_URL = `http://127.0.0.1:${hub.port}`;
    await runNotify(['run-y', 'via hub']);

    // Give server time to write
    await new Promise((r) => setTimeout(r, 200));
    const lines = readFileSync(path.join(stateDir, 'events', 'run-y.jsonl'), 'utf8').trim().split('\n');
    expect(lines).toHaveLength(1);
    const ev = JSON.parse(lines[0]);
    expect(ev.text).toBe('via hub');
  });
});
