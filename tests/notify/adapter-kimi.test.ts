import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { makeKimiAdapter } from '../../src/notify/adapters/kimi';
import { getAdapter } from '../../src/notify';

const FIXTURES = path.join(__dirname, 'fixtures');

function loadFixture(name: string): string[] {
  return readFileSync(path.join(FIXTURES, name), 'utf8').split('\n').filter(Boolean);
}

describe('kimi adapter', () => {
  const adapter = makeKimiAdapter();

  it('transformArgs inserts --print --output-format stream-json before -p prompt', () => {
    const base = ['-y', '-p', 'hello'];
    const out = adapter.transformArgs!({ runId: 'r1', eventFile: '/tmp/x' }, base);
    expect(out).toEqual([
      '-y',
      '--print',
      '--output-format', 'stream-json',
      '-p', 'hello',
    ]);
  });

  it('promptSuffix returns discuss instruction', () => {
    const suffix = adapter.promptSuffix?.({ runId: 'r1', eventFile: '/tmp/x' }) ?? '';
    expect(suffix).toContain('discuss ask');
    expect(suffix).toContain('discuss note');
  });

  it('assistant text block maps to message', () => {
    const line = JSON.stringify({
      role: 'assistant',
      content: [{ type: 'text', text: 'hello world' }],
    });
    const events = adapter.parseLine!(line);
    expect(events).toEqual([{ type: 'message', text: 'hello world' }]);
  });

  it('assistant text is truncated to 500 chars + ellipsis', () => {
    const long = 'x'.repeat(800);
    const line = JSON.stringify({
      role: 'assistant',
      content: [{ type: 'text', text: long }],
    });
    const events = adapter.parseLine!(line);
    expect((events[0].text ?? '').length).toBe(501);
    expect((events[0].text ?? '').endsWith('…')).toBe(true);
  });

  it('assistant with multiple text blocks emits one message per block', () => {
    const line = JSON.stringify({
      role: 'assistant',
      content: [
        { type: 'text', text: 'one' },
        { type: 'text', text: 'two' },
      ],
    });
    const events = adapter.parseLine!(line);
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ type: 'message', text: 'one' });
    expect(events[1]).toMatchObject({ type: 'message', text: 'two' });
  });

  it('assistant tool_call maps to tool with summarized args', () => {
    const line = JSON.stringify({
      role: 'assistant',
      content: [],
      tool_calls: [{
        type: 'function',
        id: 't1',
        function: { name: 'ReadFile', arguments: '{"path":"/etc/hostname"}' },
      }],
    });
    const events = adapter.parseLine!(line);
    expect(events[0]).toMatchObject({
      type: 'tool',
      text: 'ReadFile /etc/hostname',
      data: { name: 'ReadFile' },
    });
  });

  it('assistant tool_call with command field summarizes via command key', () => {
    const line = JSON.stringify({
      role: 'assistant',
      tool_calls: [{
        function: { name: 'Bash', arguments: '{"command":"ls -la"}' },
      }],
    });
    const events = adapter.parseLine!(line);
    expect(events[0].text).toBe('Bash ls -la');
  });

  it('assistant with text + tool_calls emits both', () => {
    const line = JSON.stringify({
      role: 'assistant',
      content: [{ type: 'text', text: 'thinking' }],
      tool_calls: [{
        function: { name: 'ReadFile', arguments: '{"path":"/a"}' },
      }],
    });
    const events = adapter.parseLine!(line);
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ type: 'message', text: 'thinking' });
    expect(events[1]).toMatchObject({ type: 'tool', text: 'ReadFile /a' });
  });

  it('think blocks are dropped (no message event)', () => {
    const line = JSON.stringify({
      role: 'assistant',
      content: [{ type: 'think', think: 'internal reasoning' }],
    });
    expect(adapter.parseLine!(line)).toEqual([]);
  });

  it('tool role with normal content returns empty (skip non-error results)', () => {
    const line = JSON.stringify({
      role: 'tool',
      content: [{ type: 'text', text: 'ok' }],
      tool_call_id: 't1',
    });
    expect(adapter.parseLine!(line)).toEqual([]);
  });

  it('tool role with error content maps to error event', () => {
    const line = JSON.stringify({
      role: 'tool',
      content: [{ type: 'text', text: 'ENOENT: no such file' }],
      tool_call_id: 't1',
    });
    const events = adapter.parseLine!(line);
    expect(events[0]).toMatchObject({ type: 'error', text: 'ENOENT: no such file' });
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

  it('unknown role returns empty array', () => {
    expect(adapter.parseLine!(JSON.stringify({ role: 'system' }))).toEqual([]);
  });

  it('fixture file parses with no errors and produces expected event types', () => {
    const lines = loadFixture('kimi.jsonl');
    expect(lines.length).toBeGreaterThan(5);
    const eventTypes = new Set<string>();
    for (const line of lines) {
      for (const e of adapter.parseLine!(line)) {
        eventTypes.add(e.type);
      }
    }
    expect(eventTypes.has('message')).toBe(true);
    expect(eventTypes.has('tool')).toBe(true);
    expect(eventTypes.has('error')).toBe(true);
  });

  it('getAdapter returns the kimi adapter for kimi agent', () => {
    const a = getAdapter('kimi');
    expect(a.name).toBe('kimi');
    expect(typeof a.transformArgs).toBe('function');
  });
});