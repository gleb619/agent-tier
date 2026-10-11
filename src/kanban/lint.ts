import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { parseLegend } from "./legend";
import { PLANS_DIR_REL, SENTINEL } from "./types";

export const ROW_RE = /^\|\s*T\d+\s*\|/;
export const ID_RE = /^\|\s*(T\d+)\s*\|/;
export const CELL_SPLIT_RE = /(?<!\\)\|/;
export const HEADER_LINE_PREFIX = "| ID";

export interface LintViolation {
  line: number;
  message: string;
}

export interface LintResult {
  violations: LintViolation[];
  rows: number;
  legend: string[];
}

/** Split on unescaped pipes only — the mirror of the mutator's `escapePipes`. */
export function splitCells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|+/, "")
    .replace(/\|+$/, "")
    .split(CELL_SPLIT_RE)
    .map((c) => c.trim());
}

export function extractIds(text: string): Set<string> {
  const ids = new Set<string>();
  for (const rawLine of text.split("\n")) {
    const m = ID_RE.exec(rawLine.trim());
    if (m) ids.add(m[1]);
  }
  return ids;
}

function planResolves(plan: string, id: string, root: string): boolean {
  const abs = path.isAbsolute(plan) ? plan : path.resolve(root, plan);
  if (existsSync(abs)) return true;

  // `clean` drops Done rows but leaves their plan files behind, so a re-added task can
  // carry a drifted slug. An `<ID>-*` file in docs/plans is accepted as the real spec.
  const plansDir = path.join(root, PLANS_DIR_REL);
  if (!id.startsWith("T") || !existsSync(plansDir)) return false;
  return readdirSync(plansDir).some((name) => {
    if (!name.startsWith(`${id}-`)) return false;
    try {
      return statSync(path.join(plansDir, name)).isFile();
    } catch {
      return false;
    }
  });
}

export function lintBoard(text: string, root: string): LintResult {
  const lines = text.split("\n");
  const legend = parseLegend(text);
  const violations: LintViolation[] = [];
  const seen = new Map<string, number>();

  let headerCols: string[] | null = null;
  let rows = 0;

  lines.forEach((rawLine, idx) => {
    const lineNo = idx + 1;
    const line = rawLine.trim();

    if (headerCols === null && line.startsWith(HEADER_LINE_PREFIX)) {
      headerCols = splitCells(line);
      return;
    }
    if (!ROW_RE.test(line)) return;
    const idMatch = ID_RE.exec(line);
    if (!idMatch) return;

    rows += 1;
    const id = idMatch[1];
    const cells = splitCells(line);
    const fail = (message: string): void => {
      violations.push({ line: lineNo, message });
    };

    if (headerCols !== null && cells.length !== headerCols.length) {
      fail(`line ${lineNo}: ${id} has ${cells.length} columns, header has ${headerCols.length}`);
    }

    if (seen.has(id)) {
      fail(`line ${lineNo}: duplicate ID ${id} (first seen at line ${seen.get(id)})`);
    } else {
      seen.set(id, lineNo);
    }

    if (headerCols === null) return;

    const statusIdx = headerCols.indexOf("Status");
    const status = statusIdx >= 0 ? (cells[statusIdx] ?? "") : "";
    if (legend.length > 0 && !legend.includes(status)) {
      fail(`line ${lineNo}: ${id} has invalid Status '${status}' (expected one of: ${[...legend].sort().join(", ")})`);
    }

    const planIdx = headerCols.indexOf("Plan File");
    const plan = (planIdx >= 0 ? (cells[planIdx] ?? "") : "").replace(/`/g, "").trim();
    if (plan && plan !== SENTINEL && !planResolves(plan, id, root)) {
      fail(`line ${lineNo}: ${id} Plan File '${plan}' does not exist`);
    }
  });

  return { violations, rows, legend };
}
