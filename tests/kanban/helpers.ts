import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { COLUMNS } from "../../src/kanban/types";

export const HEADER: string[] = [...COLUMNS];

const tmpDirs: string[] = [];

export function makeTmpDir(prefix = "at-kanban-"): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

export function cleanupTmpDirs(): void {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
}

export interface RowValues {
  title?: string;
  description?: string;
  priority?: string;
  owner?: string;
  blocks?: string;
  blockedBy?: string;
  plan?: string;
}

export const REFERENCE_STATUSES = ["Backlog", "In Progress", "Blocked", "Done"];

export function row(id: string, status: string, title = id, v: RowValues = {}): string[] {
  return [
    id,
    status,
    title,
    v.description ?? "-",
    v.priority ?? "Low",
    v.owner ?? "loop",
    v.blocks ?? "-",
    v.blockedBy ?? "-",
    v.plan ?? "-",
  ];
}

/** The reference 5-row state machine: covers every status plus priority and dependency gating. */
export function stateMachineRows(): string[][] {
  return [
    row("T1", "Done", "first"),
    row("T2", "Blocked", "second", { blockedBy: "T1" }),
    row("T3", "Backlog", "third", { priority: "High" }),
    row("T4", "Backlog", "fourth", { priority: "Low" }),
    row("T5", "In Progress", "fifth"),
  ];
}

export function boardMarkdown(rows: string[][], opts: { legend?: string[] } = {}): string {
  const statuses = opts.legend ?? REFERENCE_STATUSES;
  const legend = statuses.map((s) => `| \`${s}\` | meaning | coding agent |`).join("\n");
  const header = `| ${HEADER.join(" | ")} |`;
  const delimiter = `| ${HEADER.map(() => ":--").join(" | ")} |`;
  const body = rows.map((cells) => `| ${cells.join(" | ")} |`).join("\n");
  return `# Kanban Board

Planner board. Mutated by the CLI only.

## Status Legend

| Status | Meaning | Who updates it |
| :-- | :-- | :-- |
${legend}

## Task Board

${header}
${delimiter}
${body}
`;
}

export function writeBoard(dir: string, rows: string[][], opts: { legend?: string[]; rel?: string } = {}): string {
  const file = path.join(dir, opts.rel ?? path.join("docs", "kanban.md"));
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, boardMarkdown(rows, opts), "utf8");
  return file;
}

export function readBoard(file: string): string {
  return readFileSync(file, "utf8");
}

export function writeText(file: string, text: string): string {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text, "utf8");
  return file;
}
