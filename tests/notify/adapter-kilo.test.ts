import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { makeKiloAdapter } from '../../src/notify/adapters/kilo';
import { getAdapter } from '../../src/notify';

const FIXTURES = path.join(__dirname, 'fixtures');

function loadFixture(name: string): string[] {
  return readFileSync(path.join(FIXTURES, name), 'utf8').split('\n').filter(Boolean);
}

describe('kilo adapter', () => {
  const adapter = makeKiloAdapter();

  it('transformArgs inserts --format json before the prompt', () => {
    const base = ['run', '--auto', 'hello'];
    const out = adapter.transformArgs!({ runId: 'r1', eventFile: '/tmp/x' }, base);
    expect(out).toEqual(['run', '--auto', '--format', 'json', 'hello']);
  });

  it('promptSuffix returns discuss instruction', () => {
    const suffix = adapter.promptSuffix?.({ runId: 'r1', eventFile: '/tmp/x' }) ?? '';
    expect(suffix).toContain('discuss ask');
    expect(suffix).toContain('discuss note');
  });

  it('step_start maps to progress', () => {
    const events = adapter.parseLine!(JSON.stringify({
      type: 'step_start',
      sessionID: 'ses_1',
      part: { id: 'p1', type: 'step-start', messageID: 'm1' },
    }));
    expect(events).toEqual([{ type: 'progress', text: 'session started' }]);
  });

  it('text fragment uses accumulated field when present', () => {
    const events = adapter.parseLine!(JSON.stringify({
      type: 'text',
      part: { type: 'text', text: 'Hi' },
      accumulated: 'Hi there',
    }));
    expect(events).toEqual([{ type: 'message', text: 'Hi there' }]);
  });

  it('text fragment without accumulated falls back to text', () => {
    const events = adapter.parseLine!(JSON.stringify({
      type: 'text',
      part: { type: 'text', text: 'Hi' },
    }));
    expect(events).toEqual([{ type: 'message', text: 'Hi' }]);
  });

  it('empty text fragment returns empty array', () => {
    const events = adapter.parseLine!(JSON.stringify({
      type: 'text',
      part: { type: 'text', text: '' },
    }));
    expect(events).toEqual([]);
  });

  it('step_finish maps to progress with reason', () => {
    const events = adapter.parseLine!(JSON.stringify({
      type: 'step_finish',
      part: { type: 'step-finish', reason: 'stop', tokens: {}, cost: 0 },
    }));
    expect(events[0]).toMatchObject({ type: 'progress', text: 'session stop' });
  });

  it('non-JSON line returns empty array', () => {
    expect(adapter.parseLine!('just text')).toEqual([]);
  });

  it('malformed JSON returns empty array (never throws)', () => {
    expect(adapter.parseLine!('{not json')).toEqual([]);
  });

  it('empty line returns empty array', () => {
    expect(adapter.parseLine!('')).toEqual([]);
  });

  it('unknown type returns empty array', () => {
    expect(adapter.parseLine!(JSON.stringify({ type: 'something_else' }))).toEqual([]);
  });

  it('fixture file parses and produces expected event types', () => {
    const lines = loadFixture('kilo.jsonl');
    expect(lines.length).toBeGreaterThan(0);
    const eventTypes = new Set<string>();
    for (const line of lines) {
      for (const e of adapter.parseLine!(line)) {
        eventTypes.add(e.type);
      }
    }
    expect(eventTypes.has('progress')).toBe(true);
    expect(eventTypes.has('message')).toBe(true);
  });

  it('getAdapter returns the kilo adapter for kilo agent', () => {
    const a = getAdapter('kilo');
    expect(a.name).toBe('kilo');
    expect(typeof a.transformArgs).toBe('function');
  });
});