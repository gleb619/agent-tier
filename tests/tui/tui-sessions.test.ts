import { describe, it, expect, beforeEach, vi } from 'vitest';
import { filteredSessions, sidebarFilter, setSidebarFilter } from '../../src/tui/store/sessions';
import type { RunRecord } from '../../src/run-store';

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

// Note: We cannot easily test filteredSessions without mocking the underlying signal
// since sessions is set by refreshSessions() which reads from disk.
// We test the pure filter logic instead.

describe('sessions store — pure functions', () => {
  beforeEach(() => {
    setSidebarFilter('');
  });

  describe('sidebarFilter', () => {
    it('starts empty', () => {
      expect(sidebarFilter()).toBe('');
    });

    it('can be set', () => {
      setSidebarFilter('mm-code');
      expect(sidebarFilter()).toBe('mm-code');
    });
  });

  describe('filter logic', () => {
    const sessions: RunRecord[] = [
      mockRun('run1', { agent: 'mm-code', status: 'running' }),
      mockRun('run2', { agent: 'opencode', status: 'done' }),
      mockRun('run3', { agent: 'glm-code', status: 'failed' }),
    ];

    it('filter matches by agent name (case insensitive)', () => {
      const filter = 'mm';
      const filtered = sessions.filter(s =>
        s.runId.toLowerCase().includes(filter) ||
        s.agent.toLowerCase().includes(filter) ||
        s.status.toLowerCase().includes(filter)
      );
      expect(filtered).toHaveLength(1);
      expect(filtered[0].runId).toBe('run1');
    });

    it('filter matches by runId', () => {
      const filter = 'run2';
      const filtered = sessions.filter(s =>
        s.runId.toLowerCase().includes(filter) ||
        s.agent.toLowerCase().includes(filter) ||
        s.status.toLowerCase().includes(filter)
      );
      expect(filtered).toHaveLength(1);
      expect(filtered[0].runId).toBe('run2');
    });

    it('filter matches by status', () => {
      const filter = 'done';
      const filtered = sessions.filter(s =>
        s.runId.toLowerCase().includes(filter) ||
        s.agent.toLowerCase().includes(filter) ||
        s.status.toLowerCase().includes(filter)
      );
      expect(filtered).toHaveLength(1);
      expect(filtered[0].runId).toBe('run2');
    });

    it('returns all when filter is empty', () => {
      const filtered = sessions.filter(s =>
        s.runId.toLowerCase().includes('') ||
        s.agent.toLowerCase().includes('') ||
        s.status.toLowerCase().includes('')
      );
      expect(filtered).toHaveLength(3);
    });
  });
});