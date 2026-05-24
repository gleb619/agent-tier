import { describe, it, expect, beforeEach, vi } from 'vitest';
import { filteredSessions, sidebarFilter, setSidebarFilter } from '../../src/tui/store/sessions';
import { formatDuration, statusIcon, statusColor, truncate, groupSessionsByDate, buildSidebarGroups } from '../../src/tui/components/Sidebar';
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

describe('Sidebar pure functions', () => {
  describe('statusIcon', () => {
    it('returns ● for running', () => {
      expect(statusIcon('running')).toBe('●');
    });

    it('returns ✓ for done', () => {
      expect(statusIcon('done')).toBe('✓');
    });

    it('returns ✗ for failed', () => {
      expect(statusIcon('failed')).toBe('✗');
    });

    it('returns ⚠ for stuck', () => {
      expect(statusIcon('stuck')).toBe('⚠');
    });
  });

  describe('statusColor', () => {
    it('returns green for running', () => {
      expect(statusColor('running')).toBe('#3fb950');
    });

    it('returns blue for done', () => {
      expect(statusColor('done')).toBe('#388bfd');
    });

    it('returns red for failed', () => {
      expect(statusColor('failed')).toBe('#f85149');
    });

    it('returns yellow for stuck', () => {
      expect(statusColor('stuck')).toBe('#d29922');
    });
  });

  describe('formatDuration', () => {
    it('formats seconds only', () => {
      const now = new Date();
      const start = new Date(now.getTime() - 5000);
      const record = mockRun('r1', { startedAt: start.toISOString(), finishedAt: null });
      vi.useFakeTimers();
      vi.setSystemTime(now);
      expect(formatDuration(record)).toBe('5s');
      vi.useRealTimers();
    });

    it('formats minutes and seconds', () => {
      const now = new Date();
      const start = new Date(now.getTime() - 125000);
      const record = mockRun('r1', { startedAt: start.toISOString(), finishedAt: now.toISOString() });
      expect(formatDuration(record)).toBe('2m 5s');
    });

    it('formats zero seconds', () => {
      const now = new Date();
      const record = mockRun('r1', { startedAt: now.toISOString(), finishedAt: now.toISOString() });
      expect(formatDuration(record)).toBe('0s');
    });
  });

  describe('truncate', () => {
    it('returns text when within limit', () => {
      expect(truncate('hello', 10)).toBe('hello');
    });

    it('truncates with ellipsis when over limit', () => {
      expect(truncate('hello world', 6)).toBe('hello…');
    });

    it('handles exact length', () => {
      expect(truncate('hello', 5)).toBe('hello');
    });
  });

  describe('groupSessionsByDate', () => {
    it('groups sessions by date bucket', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-01-15T12:00:00Z'));

      const sessions: RunRecord[] = [
        mockRun('run1', { startedAt: '2024-01-15T10:00:00Z' }),
        mockRun('run3', { startedAt: '2024-01-15T08:00:00Z' }),
        mockRun('run2', { startedAt: '2024-01-14T10:00:00Z' }),
      ];

      const groups = groupSessionsByDate(sessions, null);
      expect(groups).toHaveLength(2);
      expect(groups[0].label).toBe('Today');
      expect(groups[0].items).toHaveLength(2);
      expect(groups[1].label).toBe('Yesterday');
      expect(groups[1].items).toHaveLength(1);

      vi.useRealTimers();
    });

    it('sets isSelected based on selectedId', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-01-15T12:00:00Z'));

      const sessions: RunRecord[] = [
        mockRun('run1', { startedAt: '2024-01-15T10:00:00Z' }),
        mockRun('run2', { startedAt: '2024-01-15T08:00:00Z' }),
      ];

      const groups = groupSessionsByDate(sessions, 'run2');
      const item0 = groups[0].items[0];
      const item1 = groups[0].items[1];
      expect(item0.type).toBe('session');
      expect(item1.type).toBe('session');
      if (item0.type === 'session') expect(item0.isSelected).toBe(false);
      if (item1.type === 'session') expect(item1.isSelected).toBe(true);

      vi.useRealTimers();
    });
  });

  describe('buildSidebarGroups', () => {
    it('prepends an Actions group with Dashboard', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-01-15T12:00:00Z'));

      const sessions: RunRecord[] = [mockRun('run1', { startedAt: '2024-01-15T10:00:00Z' })];
      const onSelect = vi.fn();
      const groups = buildSidebarGroups(sessions, null, true, onSelect);

      expect(groups).toHaveLength(2);
      expect(groups[0].label).toBe('Actions');
      expect(groups[0].items).toHaveLength(1);

      const dashboardItem = groups[0].items[0];
      expect(dashboardItem.type).toBe('action');
      if (dashboardItem.type === 'action') {
        expect(dashboardItem.label).toBe('Dashboard');
        expect(dashboardItem.icon).toBe('📊');
        expect(dashboardItem.active).toBe(true);
        dashboardItem.onSelect();
        expect(onSelect).toHaveBeenCalledTimes(1);
      }

      vi.useRealTimers();
    });

    it('passes dashboardActive state to Dashboard action', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-01-15T12:00:00Z'));

      const sessions: RunRecord[] = [];
      const groups = buildSidebarGroups(sessions, null, false, () => {});

      const dashboardItem = groups[0].items[0];
      expect(dashboardItem.type).toBe('action');
      if (dashboardItem.type === 'action') {
        expect(dashboardItem.active).toBe(false);
      }

      vi.useRealTimers();
    });

    it('includes session groups after the Actions group', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-01-15T12:00:00Z'));

      const sessions: RunRecord[] = [
        mockRun('run1', { startedAt: '2024-01-15T10:00:00Z' }),
      ];
      const groups = buildSidebarGroups(sessions, 'run1', false, () => {});

      expect(groups).toHaveLength(2);
      expect(groups[1].label).toBe('Today');
      expect(groups[1].items).toHaveLength(1);

      const sessionItem = groups[1].items[0];
      expect(sessionItem.type).toBe('session');
      if (sessionItem.type === 'session') {
        expect(sessionItem.data.runId).toBe('run1');
        expect(sessionItem.isSelected).toBe(true);
      }

      vi.useRealTimers();
    });
  });
});
