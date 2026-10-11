import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { extractIds } from "./lint";
import { DEFAULT_BOARD_REL, REWRITE_TRAILER } from "./types";

/** Returns stdout, or '' on any failure — the guard degrades instead of crashing CI. */
export type GitRunner = (args: string[], cwd: string) => string;

export const spawnGit: GitRunner = (args, cwd) => {
  try {
    const r = spawnSync("git", args, { cwd, encoding: "utf8" });
    return r.status === 0 ? (r.stdout ?? "") : "";
  } catch {
    return "";
  }
};

export interface GuardOptions {
  boardRel?: string;
  git?: GitRunner;
}

export interface GuardResult {
  ok: boolean;
  missing: string[];
  rewrite: boolean;
  baseIds: number;
  headIds: number;
}

/**
 * Append-only history guard. Compares ID *sets*, not content, so it is immune to the
 * column re-padding every mutation produces. Default-deny: dropping an ID requires a
 * commit in `base..HEAD` carrying the `[kanban-rewrite]` trailer as the audit trail.
 */
export function guardKanban(base: string, cwd: string, opts: GuardOptions = {}): GuardResult {
  const boardRel = opts.boardRel ?? DEFAULT_BOARD_REL;
  const git = opts.git ?? spawnGit;

  const baseText = git(["show", `${base}:${boardRel}`], cwd);
  const headPath = path.join(cwd, boardRel);
  const headText = existsSync(headPath) ? readFileSync(headPath, "utf8") : "";

  const baseIds = extractIds(baseText);
  const headIds = extractIds(headText);
  const missing = [...baseIds].filter((id) => !headIds.has(id)).sort();

  if (missing.length === 0) {
    return { ok: true, missing: [], rewrite: false, baseIds: baseIds.size, headIds: headIds.size };
  }

  const rewrite = git(["log", `${base}..HEAD`, "--format=%B"], cwd).includes(REWRITE_TRAILER);
  return { ok: rewrite, missing, rewrite, baseIds: baseIds.size, headIds: headIds.size };
}
