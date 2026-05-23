import {
  RunRecord,
  loadRuns,
  saveRuns,
  addRun,
  updateRun,
  pruneRuns,
  detectStuck,
  isPidAlive,
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
    // Ensure no state.json with maxEntries overrides default
    const stateFile = path.join(TEST_STATE_DIR, 'state.json');
    if (fs.existsSync(stateFile)) fs.unlinkSync(stateFile);
    saveRuns(TEST_STATE_DIR, []);
  });

  afterAll(() => {
    const runsFile = path.join(TEST_STATE_DIR, 'runs.json');
    if (fs.existsSync(runsFile)) fs.unlinkSync(runsFile);
    const stateFile = path.join(TEST_STATE_DIR, 'state.json');
    if (fs.existsSync(stateFile)) fs.unlinkSync(stateFile);
    try { fs.rmdirSync(TEST_STATE_DIR); } catch { /* not empty */ }
  });

  describe('loadRuns / saveRuns', () => {
    it('returns empty array when no file exists', () => {
      const runsFile = path.join(TEST_STATE_DIR, 'runs.json');
      if (fs.existsSync(runsFile)) fs.unlinkSync(runsFile);
      const result = loadRuns(TEST_STATE_DIR);
      expect(result).toEqual([]);
    });

    it('reads back what was written as JSONL', () => {
      const runs = [{ ...mockRun, runId: 'r1' }, { ...mockRun, runId: 'r2' }];
      saveRuns(TEST_STATE_DIR, runs);
      const loaded = loadRuns(TEST_STATE_DIR);
      expect(loaded).toHaveLength(2);
      expect(loaded[0].runId).toBe('r1');
      expect(loaded[1].runId).toBe('r2');

      // Verify on-disk format is JSONL
      const raw = fs.readFileSync(path.join(TEST_STATE_DIR, 'runs.json'), 'utf8');
      const lines = raw.trim().split('\n');
      expect(lines.length).toBe(2);
      expect(JSON.parse(lines[0]).runId).toBe('r1');
    });

    it('migrates old plain-JSON format on first read', () => {
      const runsFile = path.join(TEST_STATE_DIR, 'runs.json');
      fs.writeFileSync(runsFile, JSON.stringify({ runs: [{ ...mockRun, runId: 'old1' }] }), 'utf8');
      const loaded = loadRuns(TEST_STATE_DIR);
      expect(loaded).toHaveLength(1);
      expect(loaded[0].runId).toBe('old1');
    });
  });

  describe('addRun / updateRun', () => {
    it('adds and updates a run record', () => {
      saveRuns(TEST_STATE_DIR, []);

      addRun(TEST_STATE_DIR, mockRun);
      let loaded = loadRuns(TEST_STATE_DIR);
      expect(loaded).toHaveLength(1);
      expect(loaded[0].runId).toBe('abc123');
      expect(loaded[0].status).toBe('running');

      updateRun(TEST_STATE_DIR, 'abc123', { status: 'done', exitCode: 0, finishedAt: new Date().toISOString() });
      loaded = loadRuns(TEST_STATE_DIR);
      expect(loaded[0].status).toBe('done');
      expect(loaded[0].exitCode).toBe(0);

      saveRuns(TEST_STATE_DIR, []);
    });

    it('updateRun is a no-op for unknown runId', () => {
      saveRuns(TEST_STATE_DIR, []);
      addRun(TEST_STATE_DIR, mockRun);
      updateRun(TEST_STATE_DIR, 'nonexistent', { status: 'failed' });
      const loaded = loadRuns(TEST_STATE_DIR);
      expect(loaded).toHaveLength(1);
      expect(loaded[0].status).toBe('running');

      saveRuns(TEST_STATE_DIR, []);
    });

    it('autoprunes to default max of 10', () => {
      const now = Date.now();
      for (let i = 0; i < 12; i++) {
        addRun(TEST_STATE_DIR, {
          ...mockRun,
          runId: `run-${i}`,
          startedAt: new Date(now + i * 1000).toISOString(),
        });
      }
      const loaded = loadRuns(TEST_STATE_DIR);
      expect(loaded).toHaveLength(10);
      // Newest should be kept
      expect(loaded.map((r) => r.runId)).toEqual([
        'run-11', 'run-10', 'run-9', 'run-8', 'run-7', 'run-6', 'run-5', 'run-4', 'run-3', 'run-2',
      ]);
    });

    it('respects maxEntries from state.json', () => {
      const stateFile = path.join(TEST_STATE_DIR, 'state.json');
      fs.writeFileSync(stateFile, JSON.stringify({ runs: { maxEntries: 3 } }), 'utf8');

      const now = Date.now();
      for (let i = 0; i < 5; i++) {
        addRun(TEST_STATE_DIR, {
          ...mockRun,
          runId: `run-${i}`,
          startedAt: new Date(now + i * 1000).toISOString(),
        });
      }
      const loaded = loadRuns(TEST_STATE_DIR);
      expect(loaded).toHaveLength(3);
      expect(loaded.map((r) => r.runId)).toEqual(['run-4', 'run-3', 'run-2']);
    });
  });

  describe('pruneRuns', () => {
    it('removes runs older than TTL', () => {
      const old = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
      const recent = new Date().toISOString();

      saveRuns(TEST_STATE_DIR, [
        { ...mockRun, runId: 'old1', startedAt: old, finishedAt: old, status: 'done', exitCode: 0 },
        { ...mockRun, runId: 'new1', startedAt: recent, status: 'running' },
      ]);

      pruneRuns(TEST_STATE_DIR, 24 * 60 * 60 * 1000);
      const loaded = loadRuns(TEST_STATE_DIR);
      expect(loaded).toHaveLength(1);
      expect(loaded[0].runId).toBe('new1');
    });

    it('also enforces maxEntries', () => {
      const now = Date.now();
      const runs: RunRecord[] = [];
      for (let i = 0; i < 15; i++) {
        runs.push({
          ...mockRun,
          runId: `run-${i}`,
          startedAt: new Date(now + i * 1000).toISOString(),
          status: 'done',
          exitCode: 0,
          finishedAt: new Date(now + i * 1000).toISOString(),
        });
      }
      saveRuns(TEST_STATE_DIR, runs);
      pruneRuns(TEST_STATE_DIR, 24 * 60 * 60 * 1000, 5);
      const loaded = loadRuns(TEST_STATE_DIR);
      expect(loaded).toHaveLength(5);
      expect(loaded[0].runId).toBe('run-14');
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
