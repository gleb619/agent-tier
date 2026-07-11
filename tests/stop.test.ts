import { stopRun } from '../src/commands/stop';
import { RunRecord } from '../src/run-store';
import { vi, describe, it, expect, afterEach, beforeEach } from 'vitest';

vi.mock('../src/run-store', async (importOriginal) => {
  const original = (await importOriginal()) as object;
  return {
    ...original,
    loadRuns: vi.fn(),
    updateRun: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock('../src/process-utils', async (importOriginal) => {
  const original = (await importOriginal()) as object;
  return {
    ...original,
    isPidAlive: vi.fn().mockReturnValue(true),
  };
});

import { loadRuns, updateRun } from '../src/run-store';
import { isPidAlive } from '../src/process-utils';

function makeRun(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    runId: 'r3k2a1b9',
    agent: 'opencode',
    tier: 2,
    pid: 28451,
    prompt: 'fix the bug',
    logFile: '/tmp/at-logs/at-test-opencode.log',
    startedAt: new Date().toISOString(),
    finishedAt: null,
    exitCode: null,
    status: 'running',
    ...overrides,
  };
}

describe('stopRun', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    vi.mocked(isPidAlive).mockReturnValue(true);
    vi.mocked(updateRun).mockClear();
  });

  it('stops the most recent running run when runId is omitted', async () => {
    const run = makeRun();
    vi.mocked(loadRuns).mockReturnValue([run]);
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);

    await stopRun('/tmp/state', undefined, false);

    expect(killSpy).toHaveBeenCalledWith(run.pid, 'SIGTERM');
    expect(updateRun).toHaveBeenCalledWith('/tmp/state', run.runId, {
      status: 'failed',
      finishedAt: expect.any(String),
    });
  });

  it('throws when no running run exists and runId is omitted', async () => {
    vi.mocked(loadRuns).mockReturnValue([makeRun({ status: 'done' })]);

    await expect(stopRun('/tmp/state', undefined, false)).rejects.toThrow('no running run to stop');
  });

  it('resolves a run by prefix', async () => {
    const run = makeRun({ runId: 'abcdef123456', pid: 12345 });
    vi.mocked(loadRuns).mockReturnValue([run]);
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);

    await stopRun('/tmp/state', 'abc', false);

    expect(killSpy).toHaveBeenCalledWith(12345, 'SIGTERM');
    expect(updateRun).toHaveBeenCalledWith('/tmp/state', 'abcdef123456', expect.any(Object));
  });

  it('throws when runId is not found', async () => {
    vi.mocked(loadRuns).mockReturnValue([makeRun()]);

    await expect(stopRun('/tmp/state', 'xyz', false)).rejects.toThrow('run not found: xyz');
  });

  it('sends SIGKILL when force is true', async () => {
    const run = makeRun({ pid: 55555 });
    vi.mocked(loadRuns).mockReturnValue([run]);
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);

    await stopRun('/tmp/state', run.runId, true);

    expect(killSpy).toHaveBeenCalledWith(55555, 'SIGKILL');
  });

  it('does not signal when pid is not alive and returns successfully', async () => {
    const run = makeRun({ pid: 77777 });
    vi.mocked(loadRuns).mockReturnValue([run]);
    vi.mocked(isPidAlive).mockReturnValue(false);
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await stopRun('/tmp/state', run.runId, false);

    expect(killSpy).not.toHaveBeenCalled();
    expect(updateRun).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(`[at] run ${run.runId} not running (pid ${run.pid} not alive)`);
  });

  it('propagates error when process.kill throws', async () => {
    const run = makeRun({ pid: 88888 });
    vi.mocked(loadRuns).mockReturnValue([run]);
    vi.spyOn(process, 'kill').mockImplementation(() => {
      throw new Error('permission denied');
    });

    await expect(stopRun('/tmp/state', run.runId, false)).rejects.toThrow(
      'failed to signal pid 88888: permission denied',
    );
  });
});
