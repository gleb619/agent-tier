import { readFileSync } from "node:fs";
import path from "node:path";
import type { Root, Table, TableRow } from "mdast";
import { writeFileAtomicSync } from "../atomic-write";
import { withLock } from "../lock";
import { findProjectRoot } from "../state-dir";
import { parseLegend } from "./legend";
import { cellText, parseBoardText, stringifyBoard, type Processor } from "./parse";
import type { OpResult } from "./ops";
import { DEFAULT_BOARD_REL, FALLBACK_STATUSES, type Task } from "./types";

export interface BoardDoc {
  file: string;
  processor: Processor;
  tree: Root;
  table: Table;
  headers: string[];
  statuses: string[];
}

export function resolveBoardFile(explicit?: string): string {
  if (explicit) return path.resolve(explicit);
  const fromEnv = process.env.AT_KANBAN_FILE;
  if (fromEnv) return path.resolve(fromEnv);
  const root = findProjectRoot(process.cwd());
  return path.join(root ?? process.cwd(), DEFAULT_BOARD_REL);
}

export function loadBoard(file: string): BoardDoc {
  const content = readFileSync(file, "utf8");
  const parsed = parseBoardText(content);
  const legend = parseLegend(content);
  return {
    file: path.resolve(file),
    processor: parsed.processor,
    tree: parsed.tree,
    table: parsed.table,
    headers: parsed.headers,
    statuses: legend.length > 0 ? legend : [...FALLBACK_STATUSES],
  };
}

export function saveBoard(doc: BoardDoc): void {
  writeFileAtomicSync(doc.file, stringifyBoard(doc.processor, doc.tree));
}

/**
 * Read-modify-write the board under the file lock: loadBoard -> fn -> saveBoard
 * (only when the op reports a change). Concurrent mutations serialize, so every
 * writer sees the previous writer's board and no add/remove is lost.
 */
export async function mutateBoard(
  file: string,
  fn: (doc: BoardDoc) => OpResult,
  timeoutMs?: number,
): Promise<OpResult> {
  return withLock(
    file,
    () => {
      const doc = loadBoard(file);
      const result = fn(doc);
      if (result.changed) saveBoard(doc);
      return result;
    },
    timeoutMs,
  );
}

export function dataRows(doc: BoardDoc): TableRow[] {
  return doc.table.children.slice(1);
}

export function toTasks(doc: BoardDoc): Task[] {
  return dataRows(doc).map((row) => {
    const task: Task = {};
    doc.headers.forEach((header, idx) => {
      const cell = row.children[idx];
      task[header] = cell ? cellText(cell) : "";
    });
    return task;
  });
}

export function headerIndex(doc: BoardDoc, name: string): number {
  return doc.headers.indexOf(name);
}

/** Row index into `table.children`, where 0 is the header row. -1 when absent. */
export function findRowById(doc: BoardDoc, id: string): number {
  const idIdx = headerIndex(doc, "ID");
  if (idIdx === -1) return -1;
  const rows = doc.table.children;
  for (let i = 1; i < rows.length; i++) {
    const cell = rows[i].children[idIdx];
    if (cell && cellText(cell) === id) return i;
  }
  return -1;
}
