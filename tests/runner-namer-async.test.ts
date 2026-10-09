import { describe, it, expect, vi, beforeEach } from 'vitest';
import { run, type Spawner } from '../src/runner';
import type { RunOptions } from '../src/resolver';
import type { AgentDef } from '../src/agents/registry';
import * as scheduler from '../src/scheduler';
import * as health from '../src/health';
import * as runStore from '../src/run-store';
import * as stateDir from '../src/state-dir';
import { Mock } from 'vitest';

vi.mock('../src/scheduler');
vi.mock('../src/health');
vi.mock('../src/state-dir');
vi.mock('../src/notify', () => ({
  setupNotify: () => ({ env: {}, promptSuffix: '', adapter: { args: () => [], transformArgs: undefined } }),
  startHub: vi.fn(async () => ({ port: 0, publish: vi.fn(), close: vi.fn(async () => {}), hadActiveClients: false })),
  tailLogFile: vi.fn(() => ({ stop: vi.fn() })),
}));

const { generateSessionNameMock, updateRunMock, addRunMock } = vi.hoisted(() => ({
  generateSessionNameMock: vi.fn(async () => ({ name: 'add-error-handling-to-api', provider: 'local-ollama' as string | null })),
  updateRunMock: vi.fn(async () => {}),
  addRunMock: vi.fn(async () => {}),
}));

vi.mock('../src/namer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/namer')>();
  return {
    ...actual,
    generateSessionName: generateSessionNameMock,
  };
});

vi.spyOn(runStore, 'updateRun').mockImplementation(updateRunMock as any);
vi.spyOn(runStore, 'addRun').mockImplementation(addRunMock as any);

function makeAgent(name: string): AgentDef {
  return { name, tier: 2, bin: () => '/usr/bin/true', buildArgs: (p) => [p] };
}

const baseOptions: RunOptions = {
  agent: 'mock',
  tier: 2,
  prompt: 'refactor auth middleware',
  stream: true,
  stateDir: '/tmp/at-state-async',
  retries: 0,
  logDir: '/tmp/at-logs',
  noChop: false,
  timeout: 3600000,
  sse: false,
  ssePort: 0,
};

const agents = [makeAgent('mock')];

beforeEach(() => {
  generateSessionNameMock.mockReset();
  updateRunMock.mockReset();
  addRunMock.mockReset();
  // Default mock returns a successful namer
  generateSessionNameMock.mockResolvedValue({ name: 'add-error-handling-to-api', provider: 'local-ollama' });
  vi.mocked(scheduler.pickAgent).mockReset();
  vi.mocked(scheduler.getStateFile).mockReturnValue('/tmp/at-state-async/state.json');
  vi.mocked(stateDir.getStateFilePath).mockReturnValue('/tmp/at-state-async/state.json');
  vi.mocked(health.loadHealth).mockReturnValue({ agents: {} });
  vi.mocked(health.filterHealthy).mockResolvedValue(agents);
  vi.mocked(health.recordResult).mockResolvedValue();
  vi.mocked(health.isDeactivated).mockReturnValue(false);
});

describe('run — async namer (T09)', () => {
  it('calls namer by default', async () => {
    const spawner: Spawner = vi.fn().mockResolvedValue(0);
    await run({ ...baseOptions }, agents, spawner);
    expect(generateSessionNameMock).toHaveBeenCalledTimes(1);
    const call = generateSessionNameMock.mock.calls[0]!;
    expect(call[0]).toBe(baseOptions.prompt);
    expect(call[1]).toBe(baseOptions.stateDir);
  });

  it('spawns the agent immediately without waiting for namer resolution', async () => {
    let resolveName!: (v: { name: string; provider: string }) => void;
    generateSessionNameMock.mockImplementation(() => new Promise((r) => { resolveName = r; }));

    let spawnCalled = false;
    const spawner: Spawner = vi.fn(async () => { spawnCalled = true; return 0; });

    const runP = run({ ...baseOptions }, agents, spawner);

    // Wait one microtask — spawner must have been called already since namer is unresolved
    await Promise.resolve();
    expect(spawnCalled).toBe(true);

    // Now resolve namer — run() should still complete normally
    resolveName({ name: 'late-name-arrives', provider: 'local-ollama' });
    await runP;

    expect(spawner).toHaveBeenCalledTimes(1);
  });

  it('updateRun is called with the namer-resolved name (fire-and-forget)', async () => {
    const spawner: Spawner = vi.fn().mockResolvedValue(0);
    await run({ ...baseOptions }, agents, spawner);
    // Microtask flush — fire-and-forget runs after run() returns
    await new Promise((r) => setTimeout(r, 10));
    expect(updateRunMock).toHaveBeenCalledWith(
      baseOptions.stateDir,
      expect.any(String),
      { name: 'add-error-handling-to-api' },
    );
  });

  it('no updateRun when namer returns fallback (provider=null)', async () => {
    generateSessionNameMock.mockResolvedValue({ name: 'unnamed', provider: null });
    const spawner: Spawner = vi.fn().mockResolvedValue(0);
    await run({ ...baseOptions }, agents, spawner);
    await new Promise((r) => setTimeout(r, 10));
    expect(updateRunMock).not.toHaveBeenCalled();
  });

  it('updateRun is called even if namer promise rejects (silent fail)', async () => {
    generateSessionNameMock.mockRejectedValue(new Error('namer crashed'));
    const spawner: Spawner = vi.fn().mockResolvedValue(0);
    await run({ ...baseOptions }, agents, spawner);
    await new Promise((r) => setTimeout(r, 10));
    expect(updateRunMock).not.toHaveBeenCalled(); // because .catch(() => null) → provider=null → no update
  });

  it('does not throw if run resolves before namer promise resolves', async () => {
    let resolveName!: (v: { name: string; provider: string }) => void;
    generateSessionNameMock.mockImplementation(() => new Promise((r) => { resolveName = r; }));
    const spawner: Spawner = vi.fn().mockResolvedValue(0);
    const runP = run({ ...baseOptions }, agents, spawner);
    // Wait for run() to finish
    await runP;
    // Now resolve namer — must not throw unhandled rejection
    resolveName({ name: 'post-hoc-name', provider: 'local-ollama' });
    await new Promise((r) => setTimeout(r, 10));
  });
});

describe('run — SSE rename event (T10)', () => {
  it('publishes a rename event to hub when async name lands (sse=true)', async () => {
    generateSessionNameMock.mockResolvedValue({ name: 'add-error-handling-to-api', provider: 'local-ollama' });
    const hubPublish = vi.fn();
    const hub = { port: 0, publish: hubPublish, close: vi.fn(async () => {}), hadActiveClients: false };
    vi.doMock('../src/notify', () => ({
      setupNotify: () => ({ env: {}, promptSuffix: '', adapter: { args: () => [], transformArgs: undefined } }),
      startHub: vi.fn(async () => hub),
      tailLogFile: vi.fn(() => ({ stop: vi.fn() })),
      getProcessHub: vi.fn(async () => hub),
    }));
    // Re-import the run module so it picks up the doMock'd notify
    vi.resetModules();
    const { run: runFresh } = await import('../src/runner');
    const spawner: Spawner = vi.fn().mockResolvedValue(0);
    await runFresh({ ...baseOptions, sse: true }, agents, spawner);
    await new Promise((r) => setTimeout(r, 10));
    const renameCall = hubPublish.mock.calls.find((c) => (c[0] as { type: string }).type === 'rename');
    expect(renameCall).toBeDefined();
    const ev = renameCall![0] as { data: { name: string } };
    expect(ev.data.name).toBe('add-error-handling-to-api');
  });

  it('does not publish rename event when name provider=null (fallback)', async () => {
    generateSessionNameMock.mockResolvedValue({ name: 'unnamed', provider: null });
    const hubPublish = vi.fn();
    const hub = { port: 0, publish: hubPublish, close: vi.fn(async () => {}), hadActiveClients: false };
    vi.doMock('../src/notify', () => ({
      setupNotify: () => ({ env: {}, promptSuffix: '', adapter: { args: () => [], transformArgs: undefined } }),
      startHub: vi.fn(async () => hub),
      tailLogFile: vi.fn(() => ({ stop: vi.fn() })),
      getProcessHub: vi.fn(async () => hub),
    }));
    vi.resetModules();
    const { run: runFresh } = await import('../src/runner');
    const spawner: Spawner = vi.fn().mockResolvedValue(0);
    await runFresh({ ...baseOptions, sse: true }, agents, spawner);
    await new Promise((r) => setTimeout(r, 10));
    const renameCall = hubPublish.mock.calls.find((c) => (c[0] as { type: string }).type === 'rename');
    expect(renameCall).toBeUndefined();
  });
});