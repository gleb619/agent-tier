import { spawnSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { parseLegend } from "./legend";
import { checkPlanStructure } from "./plan-lint";
import { checkPlanTime, findPlanFile } from "./plan-time";
import { IN_PROGRESS, SENTINEL } from "./types";

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

/** `git check-ignore -q <path>` — true when the path matches a gitignore pattern.
 *  Returns false if git is missing, errors, or the cwd is not inside a repo. */
export function isGitIgnored(filePath: string, cwd: string): boolean {
  try {
    const r = spawnSync("git", ["check-ignore", "-q", filePath], { cwd, stdio: "ignore" });
    // status === 0 → matched an ignore pattern; null / non-zero → not ignored or git unavailable
    return r.status === 0;
  } catch {
    return false;
  }
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

export type IsIgnoredFn = (filePath: string, cwd: string) => boolean;

/** Return mtime of a file in milliseconds, or null on error. */
type MtimeFn = (filePath: string) => number | null;

function defaultMtime(filePath: string): number | null {
  try {
    return statSync(filePath).mtimeMs;
  } catch {
    return null;
  }
}

function planResolves(
  plan: string,
  id: string,
  root: string,
  boardDir: string | undefined,
  isIgnored: IsIgnoredFn,
): boolean {
  if (findPlanFile(plan, id, root, boardDir)) return true;
  // A gitignored path is absent in fresh checkouts and worktrees by design — not a lint error.
  try {
    return isIgnored(path.isAbsolute(plan) ? plan : path.resolve(root, plan), root);
  } catch {
    return false;
  }
}

export interface LintOptions {
  /** Override the git-ignore check; defaults to `isGitIgnored`. Inject a stub in tests. */
  isIgnored?: IsIgnoredFn;
  /** Directory of the board file; plan paths are resolved against it first, then the repo root. */
  boardDir?: string;
  /**
   * Warn when an In Progress task's plan file has not been modified in this many days.
   * Default: 7. Set to 0 or Infinity to disable.
   */
  staleDays?: number;
  /** Override file mtime lookup (injectable for tests). */
  getMtime?: MtimeFn;
}

export function lintBoard(text: string, root: string, opts: LintOptions = {}): LintResult {
  const checkIgnored: IsIgnoredFn = opts.isIgnored ?? isGitIgnored;
  const getMtime: MtimeFn = opts.getMtime ?? defaultMtime;
  const staleDays = opts.staleDays ?? 7;
  const staleMs = staleDays > 0 && Number.isFinite(staleDays) ? staleDays * 24 * 60 * 60 * 1000 : null;
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
    if (plan && plan !== SENTINEL) {
      if (!planResolves(plan, id, root, opts.boardDir, checkIgnored)) {
        fail(`line ${lineNo}: ${id} Plan File '${plan}' does not exist`);
      } else {
        // Plan present on disk: its structure + Time section are part of the board contract.
        const abs = findPlanFile(plan, id, root, opts.boardDir);
        if (abs) {
          const planText = readFileSync(abs, "utf8");
          for (const msg of [...checkPlanTime(planText, status), ...checkPlanStructure(planText, status)]) {
            fail(`line ${lineNo}: ${id} plan ${msg}`);
          }

          // Stale In Progress guard: warn when the plan file hasn't been touched in staleDays.
          if (staleMs !== null && status === IN_PROGRESS) {
            const mtime = getMtime(abs);
            if (mtime !== null && Date.now() - mtime > staleMs) {
              const days = Math.floor((Date.now() - mtime) / (24 * 60 * 60 * 1000));
              fail(
                `line ${lineNo}: ${id} plan file has not been modified in ${days} day(s) — task may be stale (In Progress for >${staleDays}d without progress)`,
              );
            }
          }
        }
      }
    }
  });

  return { violations, rows, legend };
}
