import {
  RunRecord,
  loadRuns,
  saveRuns,
  addRun,
  updateRun,
  pruneRuns,
  detectStuck,
  isPidAlive,
  RunsIndex,
} from '../src/run-store';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Override RUNS_FILE for tests
const TEST_RUNS_FILE = path.join(os.homedir(), '.at', 'runs.test.json');

// We need to mock the module-level RUNS_FILE — since it's a const,
// we'll test via a temp file approach by writing/reading directly
// and using the public API with a controlled environment.

// For unit tests, we'll test the logic with controlled state
const mockRun: RunRecord = {
  runId: 'abc123',
  agent: 'opencode',
  tier: 2,
  pid: 99999,
  prompt: 'test prompt',
  logFile: '/tmp/at-logs/test.log',
  startedAt: new Date().toISOString(),
  finishedAt: null,
  exitCode: null,
  status: 'running',
};

describe('run-store', () => {
  describe('loadRuns / saveRuns', () => {
    it('returns empty array when no file exists', () => {
      const result = loadRuns();
      expect(result).toEqual({ runs: [] });
    });
  });

  describe('addRun / updateRun', () => {
    it('adds and updates a run record', () => {
      // Create a fresh state
      saveRuns({ runs: [] });

      addRun(mockRun);
      let loaded = loadRuns();
      expect(loaded.runs).toHaveLength(1);
      expect(loaded.runs[0].runId).toBe('abc123');
      expect(loaded.runs[0].status).toBe('running');

      updateRun('abc123', { status: 'done', exitCode: 0, finishedAt: new Date().toISOString() });
      loaded = loadRuns();
      expect(loaded.runs[0].status).toBe('done');
      expect(loaded.runs[0].exitCode).toBe(0);

      // Cleanup
      saveRuns({ runs: [] });
    });

    it('updateRun is a no-op for unknown runId', () => {
      saveRuns({ runs: [] });
      addRun(mockRun);
      updateRun('nonexistent', { status: 'failed' });
      const loaded = loadRuns();
      expect(loaded.runs).toHaveLength(1);
      expect(loaded.runs[0].status).toBe('running');

      saveRuns({ runs: [] });
    });
  });

  describe('pruneRuns', () => {
    it('removes runs older than TTL', () => {
      const old = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
      const recent = new Date().toISOString();

      saveRuns({
        runs: [
          { ...mockRun, runId: 'old1', startedAt: old, finishedAt: old, status: 'done', exitCode: 0 },
          { ...mockRun, runId: 'new1', startedAt: recent, status: 'running' },
        ],
      });

      pruneRuns(24 * 60 * 60 * 1000);
      const loaded = loadRuns();
      expect(loaded.runs).toHaveLength(1);
      expect(loaded.runs[0].runId).toBe('new1');

      saveRuns({ runs: [] });
    });
  });

  describe('detectStuck', () => {
    it('marks running with dead PID as failed', () => {
      const runs: RunRecord[] = [
        { ...mockRun, pid: 999999999, status: 'running' },
      ];
      const result = detectStuck(runs);
      expect(result[0].status).toBe('failed');
    });

    it('leaves completed runs unchanged', () => {
      const runs: RunRecord[] = [
        { ...mockRun, status: 'done', exitCode: 0, finishedAt: new Date().toISOString() },
      ];
      const result = detectStuck(runs);
      expect(result[0].status).toBe('done');
    });
  });

  describe('isPidAlive', () => {
    it('returns false for non-existent PID', () => {
      expect(isPidAlive(999999999)).toBe(false);
    });

    it('returns true for current process', () => {
      expect(isPidAlive(process.pid)).toBe(true);
    });
  });
});
