import { main, buildRunWatchArgs, POLL_INTERVAL_MS } from '../src/run-watch';

const { isPidAliveMock, updateRunMock, spawnSyncMock } = vi.hoisted(() => ({
  isPidAliveMock: vi.fn<boolean, [number]>(),
  updateRunMock: vi.fn(async () => {}),
  spawnSyncMock: vi.fn(),
}));

vi.mock('../src/process-utils', () => ({ isPidAlive: isPidAliveMock }));
vi.mock('../src/run-store', () => ({ updateRun: updateRunMock }));
vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return { ...actual, spawnSync: spawnSyncMock };
});

const ARGS = ['12345', 'run-1', '/tmp/at-state', 'test-agent', '2', '/tmp/at-logs/run.log'];

describe('run-watch main()', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetAllMocks();
    spawnSyncMock.mockReturnValue({ status: 0, stdout: '', stderr: '' });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('polls until the pid dies, then marks the run done with exitCode null', async () => {
    isPidAliveMock.mockReturnValueOnce(true).mockReturnValue(false);
    const promise = main(ARGS);
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    expect(await promise).toBe(0);
    expect(updateRunMock).toHaveBeenCalledWith('/tmp/at-state', 'run-1', {
      status: 'done',
      finishedAt: expect.any(String),
      exitCode: null,
    });
    expect(spawnSyncMock).not.toHaveBeenCalled();
  });

  it('runs the callback with the AT_* env contract once the pid dies', async () => {
    isPidAliveMock.mockReturnValue(false);
    const promise = main([...ARGS, 'my-callback-cmd']);
    expect(await promise).toBe(0);
    expect(spawnSyncMock).toHaveBeenCalledTimes(1);
    expect(spawnSyncMock).toHaveBeenCalledWith('my-callback-cmd', [], {
      env: expect.objectContaining({
        AT_RUN_ID: 'run-1',
        AT_AGENT: 'test-agent',
        AT_TIER: '2',
        AT_EXIT_CODE: '0',
        AT_STATUS: 'done',
      }),
      stdio: 'ignore',
      shell: true,
    });
  });

  it('does not throw when the callback exits non-zero', async () => {
    isPidAliveMock.mockReturnValue(false);
    spawnSyncMock.mockReturnValue({ status: 7, stdout: '', stderr: '' });
    const promise = main([...ARGS, 'failing-callback']);
    expect(await promise).toBe(0);
    expect(spawnSyncMock).toHaveBeenCalledTimes(1);
  });

  it('returns 1 for an invalid pid without touching run-store', async () => {
    expect(await main(['abc', ...ARGS.slice(1)])).toBe(1);
    expect(await main(['-5', ...ARGS.slice(1)])).toBe(1);
    expect(updateRunMock).not.toHaveBeenCalled();
    expect(spawnSyncMock).not.toHaveBeenCalled();
  });
});

describe('buildRunWatchArgs', () => {
  const base = {
    pid: 42,
    runId: 'r1',
    stateDir: '/tmp/s',
    agent: 'a',
    tier: 2,
    logFile: '/tmp/l.log',
    prompt: 'p',
  };

  it('serialises all options with a callback', () => {
    expect(buildRunWatchArgs({ ...base, callback: 'cb-cmd' })).toEqual([
      '42', 'r1', '/tmp/s', 'a', '2', '/tmp/l.log', 'cb-cmd',
    ]);
  });

  it('omits the callback argument when empty or blank', () => {
    expect(buildRunWatchArgs({ ...base, callback: '' })).toHaveLength(6);
    expect(buildRunWatchArgs({ ...base, callback: '   ' })).toHaveLength(6);
    expect(buildRunWatchArgs(base)).toHaveLength(6);
  });
});
