import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'fs';
import os from 'os';
import path from 'path';
import { createKanbanSource, type KanbanSource } from '../../src/compose/kanban-source';
import { loadBoard, toTasks } from '../../src/kanban/board';
import { makeTmpDir, cleanupTmpDirs, writeBoard, row } from '../kanban/helpers';

let dir: string;
let boardFile: string;
let logs: string[];

function statusOf(id: string): string {
  const task = toTasks(loadBoard(boardFile)).find(t => t.ID === id);
  return task?.Status ?? '';
}

function planFileOf(id: string): string {
  const task = toTasks(loadBoard(boardFile)).find(t => t.ID === id);
  return task?.['Plan File'] ?? '';
}

function sourceFor(file: string, statusMap?: Record<string, string>): KanbanSource {
  return createKanbanSource({ boardFile: file, statusMap, log: m => logs.push(m) });
}

beforeEach(() => {
  dir = makeTmpDir();
  logs = [];
});

afterEach(() => {
  cleanupTmpDirs();
  rmSync(dir, { recursive: true, force: true });
});

describe('kanban source — claim', () => {
  it('claims the next executable task and marks it In Progress', async () => {
    boardFile = writeBoard(dir, [row('T1', 'Backlog', 'first', { priority: 'High' }), row('T2', 'Backlog', 'second')]);

    const task = await sourceFor(boardFile).claim();

    expect(task?.id).toBe('T1');
    expect(task?.title).toBe('first');
    expect(statusOf('T1')).toBe('In Progress');
    expect(statusOf('T2')).toBe('Backlog');
  });

  it('resumes an In Progress task when nothing else is executable', async () => {
    boardFile = writeBoard(dir, [row('T1', 'In Progress', 'current one'), row('T2', 'Blocked', 'other')]);

    const task = await sourceFor(boardFile).claim();

    expect(task?.id).toBe('T1');
    expect(statusOf('T1')).toBe('In Progress');
  });

  it('returns null when nothing is executable', async () => {
    boardFile = writeBoard(dir, [row('T1', 'Done', 'done'), row('T2', 'Blocked', 'blocked')]);

    expect(await sourceFor(boardFile).claim()).toBeNull();
  });

  it('never returns the same task from two concurrent claims (lock)', async () => {
    boardFile = writeBoard(dir, [
      row('T1', 'Backlog', 'one'),
      row('T2', 'Backlog', 'two'),
      row('T3', 'Backlog', 'three'),
    ]);
    const src = sourceFor(boardFile);

    const [a, b] = await Promise.all([src.claim(), src.claim()]);

    expect(a?.id).toBeTruthy();
    expect(b?.id).toBeTruthy();
    expect(a?.id).not.toBe(b?.id);
  });

  it('claimId claims a specific task by id', async () => {
    boardFile = writeBoard(dir, [row('T1', 'Backlog', 'one'), row('T2', 'Backlog', 'two')]);

    const task = await sourceFor(boardFile).claimId('T2');

    expect(task?.id).toBe('T2');
    expect(statusOf('T2')).toBe('In Progress');
    expect(statusOf('T1')).toBe('Backlog');
    expect(await sourceFor(boardFile).claimId('T9')).toBeNull();
  });

  it('resolves a relative Plan File against the board directory', async () => {
    boardFile = writeBoard(dir, [row('T1', 'Backlog', 'one', { plan: 'plans/t1.md' })]);
    mkdirSync(path.join(dir, 'docs', 'plans'), { recursive: true });
    writeFileSync(path.join(dir, 'docs', 'plans', 't1.md'), 'plan body');

    const task = await sourceFor(boardFile).claim();

    expect(task?.planFile).toBe(path.join(dir, 'docs', 'plans', 't1.md'));
  });
});

describe('kanban source — onFinish', () => {
  const info = { goalDir: '', round: 2 };

  beforeEach(() => {
    boardFile = writeBoard(dir, [row('T1', 'In Progress', 'the task')]);
    info.goalDir = mkdtempSync(path.join(os.tmpdir(), 'at-compose-out-'));
  });

  afterEach(() => {
    rmSync(info.goalDir, { recursive: true, force: true });
  });

  it('DONE marks the task Done', async () => {
    const task = (await sourceFor(boardFile).claim())!;

    await sourceFor(boardFile).onFinish(task, 'DONE', info);

    expect(statusOf('T1')).toBe('Done');
    expect(existsSync(path.join(info.goalDir, 'outcome.md'))).toBe(false);
  });

  it('FAILED marks the task Blocked and writes outcome.md', async () => {
    const task = (await sourceFor(boardFile).claim())!;

    await sourceFor(boardFile).onFinish(task, 'FAILED', info);

    expect(statusOf('T1')).toBe('Blocked');
    const outcome = readFileSync(path.join(info.goalDir, 'outcome.md'), 'utf8');
    expect(outcome).toContain('T1');
    expect(outcome).toContain('FAILED');
  });

  it('FAILED sets Plan File only when it is currently -', async () => {
    const plain = sourceFor(boardFile);
    const task = (await plain.claim())!;
    await plain.onFinish(task, 'FAILED', info);
    expect(planFileOf('T1')).toBe(path.join(info.goalDir, 'plan.md'));

    boardFile = writeBoard(dir, [row('T1', 'In Progress', 'the task', { plan: 'docs/plans/custom.md' })]);
    const task2 = (await sourceFor(boardFile).claim())!;
    await sourceFor(boardFile).onFinish(task2, 'FAILED', info);
    expect(planFileOf('T1')).toBe('docs/plans/custom.md');
  });

  it('skips a mapped status missing from the legend and warns instead of throwing', async () => {
    const src = sourceFor(boardFile, { DONE: 'Nonexistent' });
    const task = (await src.claim())!;

    await src.onFinish(task, 'DONE', info);

    expect(statusOf('T1')).toBe('In Progress');
    expect(logs.some(m => m.includes('Nonexistent'))).toBe(true);
  });

  it('warns and skips claim when the claim status is not in the legend', async () => {
    const src = sourceFor(boardFile, { claim: 'Doing' });

    expect(await src.claim()).toBeNull();
    expect(logs.some(m => m.includes('Doing'))).toBe(true);
  });
});
