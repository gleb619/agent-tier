import { describe, it, expect, beforeEach, vi } from 'vitest';
import { batch } from 'solid-js';
import {
  runsEqual,
  sessions,
  setSessions,
  selectedRunId,
  setSelectedRunId,
  selectedSession,
  sidebarFilter,
  setSidebarFilter,
} from '../../../src/tui/store/sessions';
import type { RunRecord } from '../../../src/run-store';

vi.mock('fs', () => ({
  readFileSync: vi.fn(() => {
    throw new Error('ENOENT');
  }),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  existsSync: vi.fn(() => false),
}));

vi.mock('child_process', () => ({
  spawn: vi.fn(),
}));

/** Fixed startedAt so two calls in the same ms don't drift apart. */
const FIXED_START = new Date('2024-01-01T00:00:00.000Z').toISOString();

const mockRun = (runId: string, overrides: Partial<RunRecord> = {}): RunRecord => ({
  runId,
  agent: 'test',
  tier: 2,
  pid: 99999,
  prompt: 'test prompt',
  logFile: '/tmp/test.log',
  startedAt: FIXED_START,
  finishedAt: null,
  exitCode: null,
  status: 'running',
  name: 'unnamed',
  ...overrides,
});

// Helper to compute selectedSession without relying on the module-level createMemo
// in SSR environment where createMemo does not track reactive dependencies.
function computeSelectedSession(): RunRecord | null {
  const id = selectedRunId();
  if (!id) return null;
  return sessions().find((s) => s.runId === id) ?? null;
}

describe('sessions store', () => {
  beforeEach(() => {
    batch(() => {
      setSessions([]);
      setSelectedRunId(null);
      setSidebarFilter('');
    });
  });

  describe('selectedSession', () => {
    it('returns null when no run is selected', () => {
      setSessions([mockRun('run1')]);
      expect(selectedSession()).toBeNull();
    });

    it('returns the matching session when selectedRunId is set', () => {
      const s1 = mockRun('run1', { agent: 'mm-code' });
      const s2 = mockRun('run2', { agent: 'opencode' });
      setSessions([s1, s2]);
      setSelectedRunId('run2');
      expect(computeSelectedSession()).toEqual(s2);
    });

    it('returns null when selectedRunId does not exist in sessions', () => {
      setSessions([mockRun('run1')]);
      setSelectedRunId('missing');
      expect(selectedSession()).toBeNull();
    });

    it('updates when sessions change', () => {
      const s1 = mockRun('run1', { agent: 'mm-code' });
      const s2 = mockRun('run2', { agent: 'opencode' });
      setSessions([s1]);
      setSelectedRunId('run2');
      expect(computeSelectedSession()).toBeNull();

      setSessions([s1, s2]);
      expect(computeSelectedSession()).toEqual(s2);
    });

    it('updates when selectedRunId changes', () => {
      const s1 = mockRun('run1');
      const s2 = mockRun('run2');
      setSessions([s1, s2]);
      setSelectedRunId('run1');
      expect(computeSelectedSession()).toEqual(s1);

      setSelectedRunId('run2');
      expect(computeSelectedSession()).toEqual(s2);
    });
  });

  describe('runsEqual', () => {
    it('treats identical data as equal even with fresh object identities', () => {
      // refreshRuns re-parses runs.jsonl on every poll, so identity never
      // matches — this is what lets the store skip a signal write per tick.
      const a = [mockRun('run1'), mockRun('run2')];
      const b = [mockRun('run1'), mockRun('run2')];
      expect(runsEqual(a, b)).toBe(true);
      expect(runsEqual(a, a)).toBe(true);
    });

    it('detects a length change', () => {
      expect(runsEqual([mockRun('run1')], [mockRun('run1'), mockRun('run2')])).toBe(false);
      expect(runsEqual([], [mockRun('run1')])).toBe(false);
      expect(runsEqual([], [])).toBe(true);
    });

    it('detects a reordering', () => {
      const runs = [mockRun('run1'), mockRun('run2')];
      expect(runsEqual(runs, [runs[1], runs[0]])).toBe(false);
    });

    it('detects a status transition (running → done)', () => {
      const before = [mockRun('run1', { status: 'running' })];
      const after = [
        mockRun('run1', { status: 'done', exitCode: 0, finishedAt: new Date().toISOString() }),
      ];
      expect(runsEqual(before, after)).toBe(false);
    });

    it('detects the namer renaming a run', () => {
      const before = [mockRun('run1', { name: 'unnamed' })];
      const after = [mockRun('run1', { name: 'Fix kanban lint' })];
      expect(runsEqual(before, after)).toBe(false);
    });

    it('compares every field, not just the run id', () => {
      const before = [mockRun('run1', { agent: 'mm-code', pid: 1, prompt: 'a', logFile: '/a.log' })];
      const after = [mockRun('run1', { agent: 'mm-code', pid: 2, prompt: 'a', logFile: '/a.log' })];
      expect(runsEqual(before, after)).toBe(false);
    });
  });
});
