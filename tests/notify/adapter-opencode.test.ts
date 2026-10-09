import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { makeOpenCodeAdapter } from '../../src/notify/adapters/opencode';
import { getAdapter } from '../../src/notify';
import { renderStreamJsonLine } from '../../src/chop';

const FIXTURES = path.join(__dirname, 'fixtures');

function loadFixture(name: string): string[] {
  return readFileSync(path.join(FIXTURES, name), 'utf8').split('\n').filter(Boolean);
}

describe('opencode adapter', () => {
  const adapter = makeOpenCodeAdapter();

  it('transformArgs inserts --format json before the prompt (no -m)', () => {
    const base = ['run', '--dangerously-skip-permissions', 'hello'];
    const out = adapter.transformArgs!({ runId: 'r1', eventFile: '/tmp/x' }, base);
    expect(out).toEqual(['run', '--dangerously-skip-permissions', '--format', 'json', 'hello']);
  });

  it('transformArgs preserves -m model and inserts --format json before prompt', () => {
    const base = ['run', '--dangerously-skip-permissions', '-m', 'qwen3-coder', 'hello'];
    const out = adapter.transformArgs!({ runId: 'r1', eventFile: '/tmp/x' }, base);
    expect(out).toEqual(['run', '--dangerously-skip-permissions', '-m', 'qwen3-coder', '--format', 'json', 'hello']);
  });

  it('promptSuffix returns discuss instruction', () => {
    const suffix = adapter.promptSuffix?.({ runId: 'r1', eventFile: '/tmp/x' }) ?? '';
    expect(suffix).toContain('discuss ask');
    expect(suffix).toContain('discuss note');
  });

  it('payload type=text maps to message', () => {
    const events = adapter.parseLine!(JSON.stringify({
      type: 'text',
      part: { type: 'text', text: 'ok' },
    }));
    expect(events).toEqual([{ type: 'message', text: 'ok' }]);
  });

  it('payload type=step_start maps to progress', () => {
    const events = adapter.parseLine!(JSON.stringify({
      type: 'step_start',
      part: { type: 'step-start' },
    }));
    expect(events).toEqual([{ type: 'progress', text: 'step started' }]);
  });

  it('payload type=step_finish maps to progress done', () => {
    const events = adapter.parseLine!(JSON.stringify({
      type: 'step_finish',
      part: { type: 'step-finish', reason: 'stop', tokens: { total: 10 }, cost: 0 },
    }));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'progress' });
    expect(events[0].text).toContain('done');
    expect(events[0].text).toContain('reason=stop');
    expect(events[0].data).toMatchObject({ reason: 'stop' });
  });

  it('payload type=step_finish with reason=error renders FAILED', () => {
    const events = adapter.parseLine!(JSON.stringify({
      type: 'step_finish',
      part: { type: 'step-finish', reason: 'error' },
    }));
    expect(events[0].text).toContain('FAILED');
  });

  it('tool-prefixed payload maps to tool event', () => {
    const events = adapter.parseLine!(JSON.stringify({
      type: 'tool_use',
      part: { type: 'tool', tool: 'Bash', input: { command: 'ls' } },
    }));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'tool', text: 'Bash ls', data: { name: 'Bash' } });
  });

  it('payload type=error maps to error event', () => {
    const events = adapter.parseLine!(JSON.stringify({
      type: 'error',
      part: { message: 'boom' },
    }));
    expect(events).toEqual([{ type: 'error', text: 'boom' }]);
  });

  it('text payload without text returns empty array', () => {
    const events = adapter.parseLine!(JSON.stringify({
      type: 'text',
      part: { type: 'text' },
    }));
    expect(events).toEqual([]);
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

  it('unknown payload type returns empty array', () => {
    expect(adapter.parseLine!(JSON.stringify({ type: 'mystery' }))).toEqual([]);
  });

  it('fixture file parses with no errors and produces expected event types', () => {
    const lines = loadFixture('opencode.jsonl');
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

  it('renderStreamJsonLine keeps opencode text readable', () => {
    const out = renderStreamJsonLine(JSON.stringify({
      type: 'text',
      part: { type: 'text', text: 'ok' },
    }));
    expect(out).toBe('ok');
  });

  it('renderStreamJsonLine renders opencode step_finish', () => {
    const out = renderStreamJsonLine(JSON.stringify({
      type: 'step_finish',
      part: { type: 'step-finish', reason: 'stop' },
    }));
    expect(out).toContain('done');
    expect(out).toContain('reason=stop');
  });

  it('getAdapter returns the opencode adapter for opencode agent', () => {
    const a = getAdapter('opencode');
    expect(a.name).toBe('opencode');
    expect(typeof a.transformArgs).toBe('function');
  });
});
