import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, appendFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { tailLogFile } from '../../src/notify/tailer';
import type { NotifyEvent, NotifyAdapter } from '../../src/notify/types';

describe('notify tailer', () => {
  let tmp: string;
  let logFile: string;
  const events: NotifyEvent[] = [];

  beforeEach(() => {
    tmp = mkdtempSync(path.join(tmpdir(), 'at-tail-'));
    logFile = path.join(tmp, 'agent.log');
    events.length = 0;
    writeFileSync(logFile, '');
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  function fakeAdapter(): NotifyAdapter {
    return {
      name: 'fake',
      parseLine(line) {
        return [{ type: 'tool', text: line, data: { source: 'fake' } }];
      },
    };
  }

  function wait(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }

  it('reads new lines and publishes parsed events', async () => {
    const tailer = tailLogFile(logFile, 'r1', 'fake-agent', (e) => events.push(e), fakeAdapter(), 50);
    appendFileSync(logFile, 'line one\n');
    await wait(150);
    appendFileSync(logFile, 'line two\n');
    await wait(150);
    tailer.stop();
    await wait(50);

    expect(events.map((e) => e.text)).toEqual(['line one', 'line two']);
    expect(events.every((e) => e.type === 'tool' && e.runId === 'r1' && e.agent === 'fake-agent')).toBe(true);
  });

  it('stops on stop() and flushes', async () => {
    const tailer = tailLogFile(logFile, 'r1', 'fake-agent', (e) => events.push(e), fakeAdapter(), 50);
    appendFileSync(logFile, 'only\n');
    tailer.stop();
    await wait(100);
    expect(events.map((e) => e.text)).toEqual(['only']);
  });
});
