import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { makeClineAdapter } from '../../src/notify/adapters/cline';
import { getAdapter } from '../../src/notify';

const FIXTURES = path.join(__dirname, 'fixtures');

function loadFixture(name: string): string[] {
  return readFileSync(path.join(FIXTURES, name), 'utf8').split('\n').filter(Boolean);
}

describe('cline adapter', () => {
  const adapter = makeClineAdapter();

  it('promptSuffix returns empty string', () => {
    expect(adapter.promptSuffix?.({ runId: 'r1', eventFile: '/tmp/x' })).toBe('');
  });

  it('agent_event iteration_start maps to progress', () => {
    const events = adapter.parseLine!(JSON.stringify({
      ts: '2026-01-01T00:00:00Z',
      type: 'agent_event',
      event: { type: 'iteration_start', iteration: 1 },
    }));
    expect(events).toEqual([{ type: 'progress', text: 'session started' }]);
  });

  it('agent_event content_start text uses accumulated', () => {
    const events = adapter.parseLine!(JSON.stringify({
      ts: '2026-01-01T00:00:00Z',
      type: 'agent_event',
      event: { type: 'content_start', contentType: 'text', text: 'Hi', accumulated: 'Hi there' },
    }));
    expect(events).toEqual([{ type: 'message', text: 'Hi there' }]);
  });

  it('agent_event content_start reasoning returns empty', () => {
    const events = adapter.parseLine!(JSON.stringify({
      ts: '2026-01-01T00:00:00Z',
      type: 'agent_event',
      event: { type: 'content_start', contentType: 'reasoning', text: 'thinking...' },
    }));
    expect(events).toEqual([]);
  });

  it('agent_event tool_start maps to tool', () => {
    const events = adapter.parseLine!(JSON.stringify({
      ts: '2026-01-01T00:00:00Z',
      type: 'agent_event',
      event: { type: 'tool_start', text: 'Bash ls' },
    }));
    expect(events).toEqual([{ type: 'tool', text: 'Bash ls' }]);
  });

  it('agent_event done maps to progress', () => {
    const events = adapter.parseLine!(JSON.stringify({
      ts: '2026-01-01T00:00:00Z',
      type: 'agent_event',
      event: { type: 'done', reason: 'completed' },
    }));
    expect(events).toEqual([{ type: 'progress', text: 'session done (completed)' }]);
  });

  it('run_result maps to progress and message', () => {
    const events = adapter.parseLine!(JSON.stringify({
      ts: '2026-01-01T00:00:00Z',
      type: 'run_result',
      finishReason: 'completed',
      iterations: 1,
      durationMs: 1000,
      text: 'final answer',
    }));
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ type: 'progress' });
    expect(events[0].text).toContain('completed');
    expect(events[1]).toEqual({ type: 'message', text: 'final answer' });
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
    const lines = loadFixture('cline.jsonl');
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

  it('getAdapter returns the cline adapter for cline agent', () => {
    const a = getAdapter('cline');
    expect(a.name).toBe('cline');
  });
});