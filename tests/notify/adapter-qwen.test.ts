import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { makeQwenAdapter } from '../../src/notify/adapters/qwen';
import { getAdapter } from '../../src/notify';

const FIXTURES = path.join(__dirname, 'fixtures');

function loadFixture(name: string): string[] {
  return readFileSync(path.join(FIXTURES, name), 'utf8').split('\n').filter(Boolean);
}

describe('qwen adapter', () => {
  const adapter = makeQwenAdapter();

  it('transformArgs inserts --output-format stream-json before the prompt', () => {
    const base = ['-y', 'hello'];
    const out = adapter.transformArgs!({ runId: 'r1', eventFile: '/tmp/x' }, base);
    expect(out).toEqual(['-y', '--output-format', 'stream-json', 'hello']);
  });

  it('promptSuffix returns empty string', () => {
    expect(adapter.promptSuffix?.({ runId: 'r1', eventFile: '/tmp/x' })).toBe('');
  });

  it('system init maps to progress with model and session_id', () => {
    const events = adapter.parseLine!(JSON.stringify({
      type: 'system',
      subtype: 'init',
      session_id: 'abc-123',
      model: 'qwen3.5-plus',
    }));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'progress',
      text: 'session started (model=qwen3.5-plus)',
      data: { model: 'qwen3.5-plus', session_id: 'abc-123' },
    });
  });

  it('assistant message with text block maps to message', () => {
    const events = adapter.parseLine!(JSON.stringify({
      type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'text', text: 'hello there' }] },
    }));
    expect(events).toEqual([{ type: 'message', text: 'hello there' }]);
  });

  it('assistant message with tool_use maps to tool event', () => {
    const events = adapter.parseLine!(JSON.stringify({
      type: 'assistant',
      message: { role: 'assistant', content: [
        { type: 'tool_use', name: 'Bash', input: { command: 'ls' } },
      ] },
    }));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'tool', text: 'Bash ls', data: { name: 'Bash' } });
  });

  it('user tool_result with is_error maps to error event', () => {
    const events = adapter.parseLine!(JSON.stringify({
      type: 'user',
      message: { content: [{ type: 'tool_result', is_error: true, content: 'ENOENT' }] },
    }));
    expect(events).toEqual([{ type: 'error', text: 'ENOENT' }]);
  });

  it('result success maps to progress and message', () => {
    const events = adapter.parseLine!(JSON.stringify({
      type: 'result',
      subtype: 'success',
      is_error: false,
      num_turns: 2,
      duration_ms: 1500,
      result: 'all done',
    }));
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ type: 'progress' });
    expect(events[0].text).toContain('done');
    expect(events[1]).toEqual({ type: 'message', text: 'all done' });
  });

  it('result is_error renders FAILED', () => {
    const events = adapter.parseLine!(JSON.stringify({
      type: 'result',
      subtype: 'error',
      is_error: true,
      num_turns: 1,
      duration_ms: 100,
    }));
    expect(events[0].text).toContain('FAILED');
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
    const lines = loadFixture('qwen.jsonl');
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

  it('getAdapter returns the qwen adapter for qwen agent', () => {
    const a = getAdapter('qwen');
    expect(a.name).toBe('qwen');
    expect(typeof a.transformArgs).toBe('function');
  });
});
