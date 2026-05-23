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

const TEST_STATE_DIR = path.join(os.tmpdir(), `at-test-runs-${Date.now()}`);

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
  beforeEach(() => {
    fs.mkdirSync(TEST_STATE_DIR, { recursive: true });
    saveRuns(TEST_STATE_DIR, { runs: [] });
  });

  afterAll(() => {
    const runsFile = path.join(TEST_STATE_DIR, 'runs.json');
    if (fs.existsSync(runsFile)) fs.unlinkSync(runsFile);
    try { fs.rmdirSync(TEST_STATE_DIR); } catch { /* not empty */ }
  });

  describe('loadRuns / saveRuns', () => {
    it('returns empty array when no file exists', () => {
      saveRuns(TEST_STATE_DIR, { runs: [] });
      const result = loadRuns(TEST_STATE_DIR);
      expect(result).toEqual({ runs: [] });
    });
  });

  describe('addRun / updateRun', () => {
    it('adds and updates a run record', () => {
      saveRuns(TEST_STATE_DIR, { runs: [] });

      addRun(TEST_STATE_DIR, mockRun);
      let loaded = loadRuns(TEST_STATE_DIR);
      expect(loaded.runs).toHaveLength(1);
      expect(loaded.runs[0].runId).toBe('abc123');
      expect(loaded.runs[0].status).toBe('running');

      updateRun(TEST_STATE_DIR, 'abc123', { status: 'done', exitCode: 0, finishedAt: new Date().toISOString() });
      loaded = loadRuns(TEST_STATE_DIR);
      expect(loaded.runs[0].status).toBe('done');
      expect(loaded.runs[0].exitCode).toBe(0);

      saveRuns(TEST_STATE_DIR, { runs: [] });
    });

    it('updateRun is a no-op for unknown runId', () => {
      saveRuns(TEST_STATE_DIR, { runs: [] });
      addRun(TEST_STATE_DIR, mockRun);
      updateRun(TEST_STATE_DIR, 'nonexistent', { status: 'failed' });
      const loaded = loadRuns(TEST_STATE_DIR);
      expect(loaded.runs).toHaveLength(1);
      expect(loaded.runs[0].status).toBe('running');

      saveRuns(TEST_STATE_DIR, { runs: [] });
    });
  });

  describe('pruneRuns', () => {
    it('removes runs older than TTL', () => {
      const old = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
      const recent = new Date().toISOString();

      saveRuns(TEST_STATE_DIR, {
        runs: [
          { ...mockRun, runId: 'old1', startedAt: old, finishedAt: old, status: 'done', exitCode: 0 },
          { ...mockRun, runId: 'new1', startedAt: recent, status: 'running' },
        ],
      });

      pruneRuns(TEST_STATE_DIR, 24 * 60 * 60 * 1000);
      const loaded = loadRuns(TEST_STATE_DIR);
      expect(loaded.runs).toHaveLength(1);
      expect(loaded.runs[0].runId).toBe('new1');

      saveRuns(TEST_STATE_DIR, { runs: [] });
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
