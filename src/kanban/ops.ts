import { existsSync, readFileSync } from 'fs';
import path from 'path';
import type { TableRow } from 'mdast';
import { dataRows, findRowById, headerIndex, toTasks, type BoardDoc } from './board';
import { cellText, makeCell, setCellText } from './parse';
import { nextExecutable } from './select';
import {
  DEFAULT_OWNER,
  DEFAULT_PRIORITY,
  DEFAULT_STATUS,
  DEFAULT_TITLE,
  DESC_SUFFIX,
  DONE,
  IN_PROGRESS,
  MAX_DESC,
  SENTINEL,
  VALID_PRIORITIES,
  blank,
  numericId,
  type Task,
} from './types';

export const PLAN_PREVIEW_LINES = 100;

export interface OpResult {
  messages: string[];
  warnings: string[];
  changed: boolean;
  data?: unknown;
}

function op(data?: unknown): OpResult {
  return { messages: [], warnings: [], changed: false, data };
}

function requireIndex(doc: BoardDoc, name: string): number {
  const idx = headerIndex(doc, name);
  if (idx === -1) throw new Error(`Board is missing the "${name}" column`);
  return idx;
}

function requireRow(doc: BoardDoc, id: string): number {
  const rowIdx = findRowById(doc, id);
  if (rowIdx === -1) throw new Error(`Task ${id} not found`);
  return rowIdx;
}

function nextId(doc: BoardDoc): string {
  const idIdx = headerIndex(doc, 'ID');
  let max = 0;
  for (const row of dataRows(doc)) {
    const cell = idIdx >= 0 ? row.children[idIdx] : undefined;
    if (!cell) continue;
    const n = numericId(cellText(cell));
    if (n > max) max = n;
  }
  return `T${max + 1}`;
}

export function opList(doc: BoardDoc): OpResult {
  const tasks = toTasks(doc);
  const r = op(tasks);
  for (const t of tasks) {
    r.messages.push(
      `${t.ID}\t${(t.Status ?? '').padEnd(12)}\t${(t.Priority ?? '').padEnd(6)}\t${t.Title} (${t['Blocked By'] || SENTINEL})`,
    );
  }
  return r;
}

export interface NextOptions {
  start?: boolean;
}

export function opNext(doc: BoardDoc, opts: NextOptions = {}): OpResult {
  const selection = nextExecutable(toTasks(doc));
  if (!selection) {
    const r = op(null);
    r.messages.push('No executable task found.');
    return r;
  }

  const { type, task } = selection;
  // `--start` is a no-op on an already-running task: that guard is what keeps a
  // resumed loop from re-marking the work it was interrupted in the middle of.
  if (opts.start && type === 'next') {
    const rowIdx = requireRow(doc, task.ID);
    setCellText(doc.table.children[rowIdx].children[requireIndex(doc, 'Status')], IN_PROGRESS);
    task.Status = IN_PROGRESS;
  }

  const r = op({ type, task });
  r.changed = Boolean(opts.start && type === 'next');
  r.messages.push(`${type === 'current' ? 'Current' : 'Next'}: ${task.ID} - ${task.Title} [${task.Priority}]`);
  if (r.changed) r.messages.push(`Marked ${task.ID} as In Progress.`);
  return r;
}

export interface ShowOptions {
  withPlan?: boolean;
}

export function resolvePlanPath(boardFile: string, planPath: string): string {
  if (path.isAbsolute(planPath)) return planPath;
  if (planPath.startsWith('./') || planPath.startsWith('../')) return path.resolve(planPath);
  return path.resolve(path.dirname(path.resolve(boardFile)), planPath);
}

export function opShow(doc: BoardDoc, id: string, opts: ShowOptions = {}): OpResult {
  const task = toTasks(doc).find((t) => (t.ID ?? '').trim() === id.trim());
  if (!task) throw new Error(`Task ${id} not found`);

  const data: { task: Task; plan?: string } = { task };
  const r = op(data);

  r.messages.push(`==> Task ${id}`);
  const field = (label: string, value: string | undefined): void => {
    r.messages.push(`${label.padEnd(12)} ${value !== undefined && value !== '' ? value : SENTINEL}`);
  };
  field('ID:', task.ID);
  field('Status:', task.Status);
  field('Priority:', task.Priority);
  field('Title:', task.Title);
  field('Description:', task.Description);
  field('Owner:', task.Owner);
  field('Blocks:', task.Blocks);
  field('Blocked By:', task['Blocked By']);
  field('Plan File:', task['Plan File']);

  if (!opts.withPlan || blank(task['Plan File'])) return r;

  const abs = resolvePlanPath(doc.file, task['Plan File'].replace(/`/g, '').trim());
  if (!existsSync(abs)) {
    r.warnings.push(`[warn] Plan file not found: ${abs}`);
    return r;
  }

  data.plan = abs;
  const lines = readFileSync(abs, 'utf8').split('\n');
  r.messages.push('', `==> Plan preview (first ${PLAN_PREVIEW_LINES} lines) — ${abs}`);
  r.messages.push(...lines.slice(0, PLAN_PREVIEW_LINES));
  if (lines.length > PLAN_PREVIEW_LINES) r.messages.push('...');
  r.messages.push('', `[note] For full details, read the complete plan file: ${abs}`);
  return r;
}

export interface AddOptions {
  id?: string;
  title?: string;
  priority?: string;
  owner?: string;
  blocks?: string;
  blockedBy?: string;
  plan?: string;
  description?: string;
}

export function opAdd(doc: BoardDoc, opts: AddOptions): OpResult {
  if (opts.priority !== undefined && !VALID_PRIORITIES.includes(opts.priority)) {
    throw new Error(`Invalid priority "${opts.priority}". Allowed: ${VALID_PRIORITIES.join(', ')}`);
  }

  const idIdx = requireIndex(doc, 'ID');
  const id = opts.id?.trim() || nextId(doc);
  const existingRowIdx = findRowById(doc, id);
  const isUpdate = existingRowIdx !== -1;
  const existing = isUpdate ? toTasks(doc).find((t) => t.ID === id) : undefined;

  const r = op();
  const values: Record<string, string> = {};
  for (const header of doc.headers) values[header] = existing?.[header] || SENTINEL;

  // Omitted fields fall back to the existing row, so `add` is an idempotent upsert —
  // and it never touches Status, because `add` is not a status mutator.
  values.ID = id;
  values.Status = existing?.Status || DEFAULT_STATUS;
  values.Title = opts.title || existing?.Title || DEFAULT_TITLE;
  values.Priority = opts.priority || existing?.Priority || DEFAULT_PRIORITY;
  values.Owner = opts.owner || existing?.Owner || DEFAULT_OWNER;
  values.Blocks = opts.blocks || existing?.Blocks || SENTINEL;
  values['Blocked By'] = opts.blockedBy || existing?.['Blocked By'] || SENTINEL;
  values['Plan File'] = opts.plan || existing?.['Plan File'] || SENTINEL;
  values.Description = existing?.Description || SENTINEL;

  if (opts.description !== undefined) {
    // Code points, not UTF-16 units: emoji and CJK must count as one and never split a surrogate.
    const chars = [...opts.description];
    values.Description = chars.join('');
    if (chars.length > MAX_DESC) {
      values.Description = chars.slice(0, MAX_DESC - DESC_SUFFIX.length).join('') + DESC_SUFFIX;
      r.warnings.push(
        `[kanban-add] DESCRIPTION exceeds ${MAX_DESC} characters; trimmed and appended '${DESC_SUFFIX}'`,
      );
    }
  }

  const newRow: TableRow = {
    type: 'tableRow',
    children: doc.headers.map((h) => makeCell(values[h] || SENTINEL)),
  };
  const rows = doc.table.children;

  if (isUpdate) {
    rows[existingRowIdx] = newRow;
  } else {
    const newNum = numericId(id);
    let insertedAt = -1;
    for (let i = 1; i < rows.length; i++) {
      if (numericId(cellText(rows[i].children[idIdx])) > newNum) {
        rows.splice(i, 0, newRow);
        insertedAt = i;
        break;
      }
    }
    if (insertedAt === -1) rows.push(newRow);
  }

  r.changed = true;
  r.messages.push(`${isUpdate ? 'Updated' : 'Added'} ${id}: ${values.Title}`);
  r.data = { id, title: values.Title, updated: isUpdate, task: { ...values } };
  return r;
}

export function opStatus(doc: BoardDoc, id: string, status: string): OpResult {
  if (!doc.statuses.includes(status)) {
    throw new Error(`Invalid status. Allowed: ${doc.statuses.join(', ')}`);
  }
  const rowIdx = requireRow(doc, id);
  setCellText(doc.table.children[rowIdx].children[requireIndex(doc, 'Status')], status);
  const r = op({ id, status });
  r.changed = true;
  r.messages.push(`Updated ${id} -> ${status}`);
  return r;
}

export function opRemove(doc: BoardDoc, id: string): OpResult {
  const rowIdx = requireRow(doc, id);
  doc.table.children.splice(rowIdx, 1);
  const r = op({ id });
  r.changed = true;
  r.messages.push(`Removed ${id}`);
  return r;
}

export function opClean(doc: BoardDoc): OpResult {
  const statusIdx = requireIndex(doc, 'Status');
  const idIdx = requireIndex(doc, 'ID');
  const rows = doc.table.children;
  const removed: string[] = [];

  // Backwards, so splicing keeps the remaining indices valid.
  for (let i = rows.length - 1; i >= 1; i--) {
    if (cellText(rows[i].children[statusIdx]) === DONE) {
      removed.push(cellText(rows[i].children[idIdx]));
      rows.splice(i, 1);
    }
  }
  removed.reverse();

  const r = op({ removed });
  r.changed = removed.length > 0;
  r.messages.push(removed.length ? `Removed done tasks: ${removed.join(', ')}` : 'No done tasks to remove.');
  return r;
}
