import { describe, it, expect, vi, beforeEach } from 'vitest';

const { generateSessionNameMock, updateRunMock, appendFileMock } = vi.hoisted(() => ({
  generateSessionNameMock: vi.fn(),
  updateRunMock: vi.fn(async () => {}),
  appendFileMock: vi.fn(),
}));

vi.mock('../src/namer', () => ({ generateSessionName: generateSessionNameMock }));
vi.mock('../src/run-store', () => ({ updateRun: updateRunMock }));
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return { ...actual, appendFileSync: appendFileMock };
});

import { applyRunName } from '../src/naming';

const BASE = { stateDir: '/tmp/at-naming', runId: 'red-bold-vega-ab12c', prompt: 'refactor the auth module' };

describe('applyRunName', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    generateSessionNameMock.mockResolvedValue({ name: 'refactor-auth-module-oidc', provider: 'local-ollama' });
    updateRunMock.mockResolvedValue(undefined);
  });

  it('persists the name and reports the winning provider', async () => {
    const out = await applyRunName({ ...BASE });
    expect(out).toEqual({ name: 'refactor-auth-module-oidc', provider: 'local-ollama' });
    expect(generateSessionNameMock).toHaveBeenCalledWith(BASE.prompt, BASE.stateDir, {});
    expect(updateRunMock).toHaveBeenCalledWith(BASE.stateDir, BASE.runId, {
      name: 'refactor-auth-module-oidc',
    });
  });

  it('appends a namer line to the run log when logFile is given', async () => {
    await applyRunName({ ...BASE, logFile: '/tmp/at-logs/run.log' });
    const lines = appendFileMock.mock.calls.filter((c) => c[0] === '/tmp/at-logs/run.log');
    expect(lines).toHaveLength(1);
    expect(lines[0]![1]).toContain('refactor-auth-module-oidc');
    expect(lines[0]![1]).toContain('local-ollama');
  });

  it('does not touch the run log without logFile', async () => {
    await applyRunName({ ...BASE });
    expect(appendFileMock).not.toHaveBeenCalled();
  });

  it('skips the write when every provider failed (provider=null fallback)', async () => {
    generateSessionNameMock.mockResolvedValue({ name: 'unnamed', provider: null });
    const out = await applyRunName({ ...BASE });
    expect(out).toBeNull();
    expect(updateRunMock).not.toHaveBeenCalled();
  });

  it('never calls the namer for an empty or whitespace prompt', async () => {
    expect(await applyRunName({ ...BASE, prompt: '' })).toBeNull();
    expect(await applyRunName({ ...BASE, prompt: '   \n ' })).toBeNull();
    expect(generateSessionNameMock).not.toHaveBeenCalled();
    expect(updateRunMock).not.toHaveBeenCalled();
  });

  it('swallows a namer crash and resolves null', async () => {
    generateSessionNameMock.mockRejectedValue(new Error('namer exploded'));
    await expect(applyRunName({ ...BASE })).resolves.toBeNull();
    expect(updateRunMock).not.toHaveBeenCalled();
  });

  it('swallows a run-store failure and resolves null', async () => {
    updateRunMock.mockRejectedValue(new Error('runs.jsonl locked'));
    await expect(applyRunName({ ...BASE })).resolves.toBeNull();
  });

  it('swallows a log-append failure but still returns the name', async () => {
    appendFileMock.mockImplementation(() => {
      throw new Error('log gone');
    });
    const out = await applyRunName({ ...BASE, logFile: '/tmp/at-logs/deleted.log' });
    expect(out).toEqual({ name: 'refactor-auth-module-oidc', provider: 'local-ollama' });
    expect(updateRunMock).toHaveBeenCalled();
  });

  it('forwards an AbortSignal to the orchestrator', async () => {
    const signal = new AbortController().signal;
    await applyRunName({ ...BASE, signal });
    expect(generateSessionNameMock).toHaveBeenCalledWith(BASE.prompt, BASE.stateDir, { signal });
  });

  it('passes logTail as a reflection context to the orchestrator', async () => {
    await applyRunName({ ...BASE, logTail: 'wrote tests for the naming queue' });
    expect(generateSessionNameMock).toHaveBeenCalledWith(BASE.prompt, BASE.stateDir, {
      context: expect.stringContaining('wrote tests for the naming queue'),
    });
    expect(updateRunMock).toHaveBeenCalledWith(BASE.stateDir, BASE.runId, {
      name: 'refactor-auth-module-oidc',
    });
  });

  it('marks the context as a run-log tail', async () => {
    await applyRunName({ ...BASE, logTail: 'did stuff' });
    expect(generateSessionNameMock).toHaveBeenCalledWith(BASE.prompt, BASE.stateDir, {
      context: expect.stringContaining('--- run log tail ---'),
    });
  });

  it('folds the run cwd into the context header when given', async () => {
    await applyRunName({ ...BASE, logTail: 'did stuff', cwd: '/repo/feature-x' });
    expect(generateSessionNameMock).toHaveBeenCalledWith(BASE.prompt, BASE.stateDir, {
      context: expect.stringContaining('cwd: /repo/feature-x'),
    });
  });

  it('falls back to prompt-only naming when logTail is empty', async () => {
    await applyRunName({ ...BASE, logTail: '' });
    expect(generateSessionNameMock).toHaveBeenCalledWith(BASE.prompt, BASE.stateDir, {});
  });
});
