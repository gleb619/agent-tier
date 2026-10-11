import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import path from 'path';
import os from 'os';
import type { RunRecord } from '../../../src/run-store';
import { saveRuns } from '../../../src/run-store';

const root = path.join(os.tmpdir(), `at-tui-join-${process.pid}`);
const projectDir = path.join(root, 'project');
const projectAt = path.join(projectDir, '.at');
const homeAt = path.join(root, 'home', '.at');

let savedStateDir: string | undefined;

function run(runId: string, minutesAgo: number, status: RunRecord['status'] = 'done'): RunRecord {
  const startedAt = new Date(Date.now() - minutesAgo * 60_000).toISOString();
  return {
    runId,
    agent: 'opencode',
    tier: 2,
    pid: 999999,
    prompt: 'test prompt',
    logFile: '/tmp/at-tui-join-test.log',
    startedAt,
    finishedAt: startedAt,
    exitCode: 0,
    status,
    name: 'unnamed',
  };
}

beforeEach(() => {
  vi.resetModules();
  savedStateDir = process.env.AT_STATE_DIR;
  delete process.env.AT_STATE_DIR;
  rmSync(root, { recursive: true, force: true });
  mkdirSync(projectAt, { recursive: true });
  mkdirSync(homeAt, { recursive: true });
  mkdirSync(path.join(projectDir, '.git'), { recursive: true });
  writeFileSync(path.join(projectAt, 'state.json'), '{}');
  vi.spyOn(os, 'homedir').mockReturnValue(path.join(root, 'home'));
  vi.spyOn(process, 'cwd').mockReturnValue(projectDir);
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(root, { recursive: true, force: true });
  if (savedStateDir === undefined) delete process.env.AT_STATE_DIR;
  else process.env.AT_STATE_DIR = savedStateDir;
});

// Regression: `at status` joins project `.at/` + `~/.at/` (scope join), but the
// TUI resolved a single dir, so global runs (e.g. crimson-sharp-whirlpool-4kiit
// in ~/.at/runs.jsonl) were invisible while `at status` showed them.
describe('tui sessions store — joined scopes', () => {
  it('shows global runs alongside project runs, newest first', async () => {
    const { refreshSessions, sessions } = await import('../../../src/tui/store/sessions');
    saveRuns(projectAt, [run('project-run-1', 120)]);
    saveRuns(homeAt, [run('crimson-sharp-whirlpool-4kiit', 60)]);

    await refreshSessions();

    expect(sessions().map((r) => r.runId)).toEqual(['crimson-sharp-whirlpool-4kiit', 'project-run-1']);
  });

  it('dedupes by runId, project copy wins', async () => {
    const { refreshSessions, sessions } = await import('../../../src/tui/store/sessions');
    saveRuns(projectAt, [run('dup-1', 60, 'done')]);
    saveRuns(homeAt, [run('dup-1', 60, 'failed')]);

    await refreshSessions();

    expect(sessions()).toHaveLength(1);
    expect(sessions()[0].status).toBe('done');
  });

  it('auto-selects the newest joined run when nothing is selected', async () => {
    const { refreshSessions, selectedRunId } = await import('../../../src/tui/store/sessions');
    saveRuns(projectAt, [run('project-run-1', 120)]);
    saveRuns(homeAt, [run('crimson-sharp-whirlpool-4kiit', 60)]);

    await refreshSessions();

    expect(selectedRunId()).toBe('crimson-sharp-whirlpool-4kiit');
  });

  it('single scope when project has no .at state: no scope tag', async () => {
    rmSync(projectAt, { recursive: true, force: true });
    const { refreshSessions, sessions } = await import('../../../src/tui/store/sessions');
    saveRuns(homeAt, [run('global-only', 60)]);

    await refreshSessions();

    expect(sessions().map((r) => r.runId)).toEqual(['global-only']);
    expect(sessions()[0]).not.toHaveProperty('scope');
  });
});
