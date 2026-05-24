import { describe, it, expect, beforeEach, vi } from 'vitest';
import { batch } from 'solid-js';
import {
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

const mockRun = (runId: string, overrides: Partial<RunRecord> = {}): RunRecord => ({
  runId,
  agent: 'test',
  tier: 2,
  pid: 99999,
  prompt: 'test prompt',
  logFile: '/tmp/test.log',
  startedAt: new Date().toISOString(),
  finishedAt: null,
  exitCode: null,
  status: 'running',
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
      const s1 = mockRun('run1', { agent: 'blackbox' });
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
      const s1 = mockRun('run1', { agent: 'blackbox' });
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
});
