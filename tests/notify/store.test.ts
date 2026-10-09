import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { appendEvent, readEvents, readEventsSince, getEventFilePath } from '../../src/notify/store';
import type { NotifyEvent } from '../../src/notify/types';

describe('notify store', () => {
  let stateDir: string;

  beforeEach(() => {
    stateDir = mkdtempSync(path.join(tmpdir(), 'at-notify-'));
  });

  afterEach(() => {
    rmSync(stateDir, { recursive: true, force: true });
  });

  function event(seq: number): NotifyEvent {
    return {
      runId: 'r1',
      agent: 'mock',
      ts: new Date().toISOString(),
      seq,
      type: 'message',
      text: `m${seq}`,
    };
  }

  it('appends and reads events', () => {
    appendEvent(stateDir, event(1));
    appendEvent(stateDir, event(2));
    expect(readEvents(stateDir, 'r1')).toHaveLength(2);
    expect(readEvents(stateDir, 'r1')[1].text).toBe('m2');
  });

  it('filters since seq', () => {
    appendEvent(stateDir, event(1));
    appendEvent(stateDir, event(2));
    appendEvent(stateDir, event(3));
    expect(readEventsSince(stateDir, 'r1', 1).map((e) => e.seq)).toEqual([2, 3]);
  });

  it('returns empty for unknown run', () => {
    expect(readEvents(stateDir, 'missing')).toEqual([]);
    expect(getEventFilePath(stateDir, 'missing')).toContain('missing.jsonl');
  });
});
