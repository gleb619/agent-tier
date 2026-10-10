import { afterEach, describe, expect, it } from 'vitest';
import path from 'path';
import { loadBoard, saveBoard, toTasks } from '../../src/kanban/board';
import {
  opAdd,
  opClean,
  opList,
  opNext,
  opRemove,
  opShow,
  opStatus,
  resolvePlanPath,
} from '../../src/kanban/ops';
import { lintBoard } from '../../src/kanban/lint';
import { initBoardText } from '../../src/kanban/template';
import { MAX_DESC } from '../../src/kanban/types';
import {
  cleanupTmpDirs,
  makeTmpDir,
  readBoard,
  row,
  stateMachineRows,
  writeBoard,
  writeText,
} from './helpers';

afterEach(cleanupTmpDirs);

function fresh(rows: string[][] = stateMachineRows()) {
  const dir = makeTmpDir();
  return { dir, file: writeBoard(dir, rows) };
}

function ids(file: string): string[] {
  return toTasks(loadBoard(file)).map((t) => t.ID);
}

function statuses(file: string): string[] {
  return toTasks(loadBoard(file)).map((t) => t.Status);
}

describe('opList', () => {
  it('emits one TSV message per row including Blocked By', () => {
    const { file } = fresh();
    const r = opList(loadBoard(file));
    expect(r.messages).toHaveLength(5);
    expect(r.messages[0]).toBe('T1\tDone        \tLow   \tfirst (-)');
    expect(r.messages[1]).toContain('(T1)');
    expect(r.changed).toBe(false);
    expect(r.data).toEqual(toTasks(loadBoard(file)));
  });

  it('emits no messages for an empty board', () => {
    const { file } = fresh([]);
    expect(opList(loadBoard(file)).messages).toEqual([]);
  });
});

describe('opNext', () => {
  it('returns the In Progress task as type current', () => {
    const { file } = fresh();
    const r = opNext(loadBoard(file));
    expect(r.messages[0]).toBe('Current: T5 - fifth [Low]');
    expect((r.data as { type: string }).type).toBe('current');
    expect(r.changed).toBe(false);
  });

  it('reports no executable task when the backlog is exhausted', () => {
    const { file } = fresh([row('T1', 'Done', 'a')]);
    const r = opNext(loadBoard(file));
    expect(r.messages).toEqual(['No executable task found.']);
    expect(r.data).toBeNull();
    expect(r.changed).toBe(false);
  });

  it('--start marks the selected Backlog task In Progress', () => {
    const { file } = fresh([row('T1', 'Backlog', 'a', { priority: 'High' }), row('T2', 'Backlog', 'b')]);
    const doc = loadBoard(file);
    const r = opNext(doc, { start: true });
    expect(r.changed).toBe(true);
    expect(r.messages).toContain('Marked T1 as In Progress.');
    saveBoard(doc);
    expect(statuses(file)).toEqual(['In Progress', 'Backlog']);
  });

  it('--start is a no-op when a task is already In Progress (I7)', () => {
    const { file } = fresh();
    const doc = loadBoard(file);
    const r = opNext(doc, { start: true });
    expect(r.changed).toBe(false);
    expect(r.messages.some((m) => m.startsWith('Marked'))).toBe(false);
    saveBoard(doc);
    expect(ids(file)).toEqual(['T1', 'T2', 'T3', 'T4', 'T5']);
    expect(statuses(file)).toEqual(['Done', 'Blocked', 'Backlog', 'Backlog', 'In Progress']);
  });

  it('picks High priority and the lowest numeric ID on a tie', () => {
    const { file } = fresh([
      row('T10', 'Backlog', 'ten', { priority: 'High' }),
      row('T9', 'Backlog', 'nine', { priority: 'High' }),
      row('T2', 'Backlog', 'two', { priority: 'Low' }),
    ]);
    expect((opNext(loadBoard(file)).data as { task: { ID: string } }).task.ID).toBe('T9');
  });
});

describe('opAdd', () => {
  it('auto-generates the next numeric ID (T9 -> T10)', () => {
    const { file } = fresh([row('T9', 'Done', 'nine')]);
    const doc = loadBoard(file);
    const r = opAdd(doc, { title: 'ten' });
    saveBoard(doc);
    expect(r.messages).toEqual(['Added T10: ten']);
    expect(ids(file)).toEqual(['T9', 'T10']);
  });

  it('starts at T1 on an empty board', () => {
    const { file } = fresh([]);
    const doc = loadBoard(file);
    opAdd(doc, { title: 'first' });
    saveBoard(doc);
    expect(ids(file)).toEqual(['T1']);
  });

  it('inserts in numeric-ID order, not at the end (I6)', () => {
    const { file } = fresh([row('T1', 'Done', 'a'), row('T3', 'Done', 'c'), row('T9', 'Done', 'i')]);
    const doc = loadBoard(file);
    opAdd(doc, { id: 'T5', title: 'e' });
    saveBoard(doc);
    expect(ids(file)).toEqual(['T1', 'T3', 'T5', 'T9']);
  });

  it('appends when the new ID sorts after every existing row', () => {
    const { file } = fresh([row('T1', 'Done', 'a')]);
    const doc = loadBoard(file);
    opAdd(doc, { id: 'T7', title: 'g' });
    saveBoard(doc);
    expect(ids(file)).toEqual(['T1', 'T7']);
  });

  it('upserts: only the supplied fields change, the rest are preserved', () => {
    const { file } = fresh([row('T1', 'Backlog', 'old title', { priority: 'High', owner: 'boris' })]);
    const doc = loadBoard(file);
    const r = opAdd(doc, { id: 'T1', title: 'new title' });
    saveBoard(doc);
    expect(r.messages).toEqual(['Updated T1: new title']);
    expect(toTasks(loadBoard(file))[0]).toMatchObject({
      ID: 'T1',
      Status: 'Backlog',
      Title: 'new title',
      Priority: 'High',
      Owner: 'boris',
    });
  });

  it('upsert never clobbers Status', () => {
    const { file } = fresh([row('T1', 'In Progress', 'running')]);
    const doc = loadBoard(file);
    opAdd(doc, { id: 'T1', title: 'retitled' });
    saveBoard(doc);
    expect(statuses(file)).toEqual(['In Progress']);
  });

  it('applies defaults only to genuinely new rows', () => {
    const { file } = fresh([]);
    const doc = loadBoard(file);
    opAdd(doc, {});
    saveBoard(doc);
    expect(toTasks(loadBoard(file))[0]).toEqual({
      ID: 'T1',
      Status: 'Backlog',
      Title: 'New task',
      Description: '-',
      Priority: 'Low',
      Owner: 'loop',
      Blocks: '-',
      'Blocked By': '-',
      'Plan File': '-',
    });
  });

  it('trims an over-length description to 125 chars + "..." and warns instead of failing (I9)', () => {
    const { file } = fresh([]);
    const doc = loadBoard(file);
    const r = opAdd(doc, { title: 'x', description: 'a'.repeat(MAX_DESC + 50) });
    saveBoard(doc);
    const desc = toTasks(loadBoard(file))[0].Description;
    expect(desc).toBe('a'.repeat(MAX_DESC - 3) + '...');
    expect([...desc]).toHaveLength(MAX_DESC);
    expect(r.warnings[0]).toBe(
      `[kanban-add] DESCRIPTION exceeds ${MAX_DESC} characters; trimmed and appended '...'`,
    );
  });

  it('counts description length in code points, never splitting a surrogate pair', () => {
    const { file } = fresh([]);
    const doc = loadBoard(file);
    opAdd(doc, { title: 'x', description: '🙂'.repeat(MAX_DESC + 2) });
    saveBoard(doc);
    const desc = toTasks(loadBoard(file))[0].Description;
    expect(desc).toBe('🙂'.repeat(MAX_DESC - 3) + '...');
    expect([...desc]).toHaveLength(MAX_DESC);
    expect(desc.includes('\uFFFD')).toBe(false);
  });

  it('accepts a description of exactly the max length without warning', () => {
    const { file } = fresh([]);
    const doc = loadBoard(file);
    expect(opAdd(doc, { title: 'x', description: 'a'.repeat(MAX_DESC) }).warnings).toEqual([]);
  });

  it('rejects an invalid priority', () => {
    const { file } = fresh([]);
    expect(() => opAdd(loadBoard(file), { title: 'x', priority: 'Urgent' })).toThrow(
      /Invalid priority "Urgent"\. Allowed: High, Medium, Low/,
    );
  });

  it('keeps the board lint-clean after adding a row', () => {
    const { dir, file } = fresh([]);
    const doc = loadBoard(file);
    opAdd(doc, { title: 'added', priority: 'Medium', description: 'hello' });
    saveBoard(doc);
    expect(lintBoard(readBoard(file), dir).violations).toEqual([]);
  });
});

describe('opStatus', () => {
  it('sets a valid status', () => {
    const { file } = fresh([row('T1', 'Backlog', 'a')]);
    const doc = loadBoard(file);
    const r = opStatus(doc, 'T1', 'Done');
    saveBoard(doc);
    expect(r.messages).toEqual(['Updated T1 -> Done']);
    expect(statuses(file)).toEqual(['Done']);
  });

  it('rejects a status that is not in the legend', () => {
    const { file } = fresh([row('T1', 'Backlog', 'a')]);
    expect(() => opStatus(loadBoard(file), 'T1', 'Doing')).toThrow(
      'Invalid status. Allowed: Backlog, In Progress, Blocked, Done',
    );
  });

  it('accepts a custom status added to the legend — the legend is the schema', () => {
    const dir = makeTmpDir();
    const file = writeBoard(dir, [row('T1', 'Backlog', 'a')], {
      legend: ['Backlog', 'Review', 'Done'],
    });
    const doc = loadBoard(file);
    opStatus(doc, 'T1', 'Review');
    saveBoard(doc);
    expect(statuses(file)).toEqual(['Review']);
  });

  it('throws for an unknown task ID', () => {
    const { file } = fresh([row('T1', 'Backlog', 'a')]);
    expect(() => opStatus(loadBoard(file), 'T9', 'Done')).toThrow('Task T9 not found');
  });
});

describe('opRemove', () => {
  it('splices the row out', () => {
    const { file } = fresh([row('T1', 'Done', 'a'), row('T2', 'Done', 'b')]);
    const doc = loadBoard(file);
    const r = opRemove(doc, 'T1');
    saveBoard(doc);
    expect(r.messages).toEqual(['Removed T1']);
    expect(ids(file)).toEqual(['T2']);
  });

  it('throws for an unknown ID', () => {
    const { file } = fresh([row('T1', 'Done', 'a')]);
    expect(() => opRemove(loadBoard(file), 'T9')).toThrow('Task T9 not found');
  });
});

describe('opClean', () => {
  it('removes every Done row and reports them in ascending order', () => {
    const { file } = fresh([
      row('T1', 'Done', 'a'),
      row('T2', 'Backlog', 'b'),
      row('T3', 'Done', 'c'),
      row('T4', 'In Progress', 'd'),
    ]);
    const doc = loadBoard(file);
    const r = opClean(doc);
    saveBoard(doc);
    expect(r.messages).toEqual(['Removed done tasks: T1, T3']);
    expect(r.data).toEqual({ removed: ['T1', 'T3'] });
    expect(ids(file)).toEqual(['T2', 'T4']);
  });

  it('reports nothing to remove and does not mark the board changed', () => {
    const { file } = fresh([row('T1', 'Backlog', 'a')]);
    const r = opClean(loadBoard(file));
    expect(r.messages).toEqual(['No done tasks to remove.']);
    expect(r.changed).toBe(false);
  });
});

describe('opShow', () => {
  it('prints a label-aligned field block', () => {
    const { file } = fresh([row('T1', 'Backlog', 'a title', { priority: 'High' })]);
    const r = opShow(loadBoard(file), 'T1');
    expect(r.messages[0]).toBe('==> Task T1');
    expect(r.messages).toHaveLength(10);
    for (const line of r.messages.slice(1)) {
      expect(line[12]).toBe(' ');
      expect(line.slice(0, 12).trim().endsWith(':')).toBe(true);
      expect(line.slice(13)).not.toBe('');
    }
    expect(r.messages.some((m) => /^ID:\s+T1$/.test(m))).toBe(true);
    expect(r.messages.some((m) => /^Priority:\s+High$/.test(m))).toBe(true);
    expect(r.messages.some((m) => /^Blocked By:\s+-$/.test(m))).toBe(true);
    expect(r.changed).toBe(false);
  });

  it('throws for an unknown ID', () => {
    const { file } = fresh([row('T1', 'Backlog', 'a')]);
    expect(() => opShow(loadBoard(file), 'T9')).toThrow('Task T9 not found');
  });

  it('previews the plan file and marks truncation past 100 lines', () => {
    const dir = makeTmpDir();
    const planAbs = path.join(dir, 'docs', 'plans', 'T1-spec.md');
    writeText(planAbs, Array.from({ length: 120 }, (_, i) => `line ${i + 1}`).join('\n'));
    const file = writeBoard(dir, [row('T1', 'Backlog', 'a', { plan: 'plans/T1-spec.md' })]);

    const r = opShow(loadBoard(file), 'T1', { withPlan: true });
    expect(r.messages).toContain(`==> Plan preview (first 100 lines) — ${planAbs}`);
    expect(r.messages).toContain('line 1');
    expect(r.messages).toContain('line 100');
    expect(r.messages).not.toContain('line 101');
    expect(r.messages).toContain('...');
    expect(r.messages[r.messages.length - 1]).toContain('[note] For full details');
    expect((r.data as { plan?: string }).plan).toBe(planAbs);
  });

  it('warns instead of throwing when the plan file is missing', () => {
    const dir = makeTmpDir();
    const file = writeBoard(dir, [row('T1', 'Backlog', 'a', { plan: 'plans/T1-nope.md' })]);
    const r = opShow(loadBoard(file), 'T1', { withPlan: true });
    expect(r.warnings[0]).toMatch(/^\[warn] Plan file not found: /);
    expect(r.messages.some((m) => m.includes('Plan preview'))).toBe(false);
  });

  it('skips the plan preview when Plan File is the "-" sentinel', () => {
    const { file } = fresh([row('T1', 'Backlog', 'a')]);
    const r = opShow(loadBoard(file), 'T1', { withPlan: true });
    expect(r.warnings).toEqual([]);
    expect(r.messages.some((m) => m.includes('Plan preview'))).toBe(false);
  });

  it('accepts a backtick-wrapped plan path', () => {
    const dir = makeTmpDir();
    const planAbs = path.join(dir, 'docs', 'plans', 'T1-spec.md');
    writeText(planAbs, '# spec\n');
    const file = writeBoard(dir, [row('T1', 'Backlog', 'a', { plan: '`plans/T1-spec.md`' })]);
    const r = opShow(loadBoard(file), 'T1', { withPlan: true });
    expect(r.warnings).toEqual([]);
    expect((r.data as { plan?: string }).plan).toBe(planAbs);
  });
});

describe('resolvePlanPath', () => {
  const BOARD = '/repo/docs/kanban.md';

  it('passes absolute paths through', () => {
    expect(resolvePlanPath(BOARD, '/abs/plan.md')).toBe('/abs/plan.md');
  });

  it('resolves ./ and ../ against the cwd', () => {
    expect(resolvePlanPath(BOARD, './docs/plans/x.md')).toBe(path.resolve('./docs/plans/x.md'));
    expect(resolvePlanPath(BOARD, '../x.md')).toBe(path.resolve('../x.md'));
  });

  it('resolves a bare path against the board file directory', () => {
    expect(resolvePlanPath(BOARD, 'plans/x.md')).toBe('/repo/docs/plans/x.md');
  });
});

describe('pipe escaping through the mutator (I12)', () => {
  it('escapes the pipe on disk without splitting the cell, and reads the raw value back', () => {
    const dir = makeTmpDir();
    const file = writeBoard(dir, []);
    const doc = loadBoard(file);
    opAdd(doc, { title: 'a|b', description: 'x|y' });
    saveBoard(doc);

    const text = readBoard(file);
    expect(text).toContain('a\\|b');
    expect(lintBoard(text, dir).violations).toEqual([]);
    expect(lintBoard(text, dir).rows).toBe(1);
    expect(toTasks(loadBoard(file))[0]).toMatchObject({ Title: 'a|b', Description: 'x|y' });
  });

  it('is idempotent across repeated upserts — no doubled backslash', () => {
    const dir = makeTmpDir();
    const file = writeBoard(dir, []);
    for (let i = 0; i < 3; i++) {
      const doc = loadBoard(file);
      opAdd(doc, { id: 'T1', title: 'a|b' });
      saveBoard(doc);
    }
    const text = readBoard(file);
    expect(text).toContain('a\\|b');
    expect(text).not.toContain('\\\\|');
    expect(toTasks(loadBoard(file))[0].Title).toBe('a|b');
    expect(lintBoard(text, dir).violations).toEqual([]);
  });

  it('preserves a literal backslash in a cell value', () => {
    const dir = makeTmpDir();
    const file = writeBoard(dir, []);
    const doc = loadBoard(file);
    opAdd(doc, { title: 'C:\\path' });
    saveBoard(doc);
    expect(toTasks(loadBoard(file))[0].Title).toBe('C:\\path');
    expect(lintBoard(readBoard(file), dir).violations).toEqual([]);
  });
});

describe('initBoardText', () => {
  it('parses as a board with the 9-column contract and passes lint', () => {
    const dir = makeTmpDir();
    const file = path.join(dir, 'docs', 'kanban.md');
    writeText(file, initBoardText());

    const doc = loadBoard(file);
    expect(doc.headers).toHaveLength(9);
    expect(toTasks(doc)).toEqual([]);
    expect(doc.statuses).toEqual(['Backlog', 'In Progress', 'Blocked', 'Done']);
    expect(lintBoard(readBoard(file), dir).violations).toEqual([]);
  });
});
