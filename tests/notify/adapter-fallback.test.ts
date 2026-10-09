import { describe, it, expect } from 'vitest';
import { getAdapter, logAdapter } from '../../src/notify';

/**
 * Agents without a structured-output mode (cursor, agy, mock, mock-long)
 * should fall through to the log adapter, whose promptSuffix instructs the
 * agent to invoke `at notify <runId> "<msg>"` at milestones.
 */
describe('adapter fallback', () => {
  it('cursor falls back to log adapter', () => {
    const a = getAdapter('cursor');
    expect(a).toBe(logAdapter);
    expect(typeof a.promptSuffix).toBe('function');
    const suffix = a.promptSuffix!({ runId: 'r1', eventFile: '/tmp/x' });
    expect(suffix).toContain('at notify');
    expect(suffix).toContain('r1');
  });

  it('agy falls back to log adapter', () => {
    const a = getAdapter('agy');
    expect(a).toBe(logAdapter);
    const suffix = a.promptSuffix!({ runId: 'r2', eventFile: '/tmp/x' });
    expect(suffix).toContain('at notify');
    expect(suffix).toContain('r2');
  });

  it('mock falls back to log adapter', () => {
    const a = getAdapter('mock');
    expect(a).toBe(logAdapter);
  });

  it('mock-long falls back to log adapter', () => {
    const a = getAdapter('mock-long');
    expect(a).toBe(logAdapter);
  });

  it('unknown agent falls back to log adapter', () => {
    const a = getAdapter('does-not-exist');
    expect(a).toBe(logAdapter);
  });
});