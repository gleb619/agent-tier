import { execFile as _execFile } from "node:child_process";
import { existsSync, symlinkSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(_execFile);

export type GitRunner = (args: string[], cwd: string) => Promise<string>;

const defaultGit: GitRunner = async (args, cwd) => (await execFileAsync("git", args, { cwd })).stdout.trim();

export interface TaskWorktree {
  path: string;
  branch: string;
}

/** Sibling of the main checkout, mirroring scripts/worktree-new.sh: `<repo>-<task>` on `feat/<task>`. */
export function taskWorktreePlan(repoRoot: string, taskId: string): TaskWorktree {
  const slug = taskId.toLowerCase();
  return { path: path.join(path.dirname(repoRoot), `${path.basename(repoRoot)}-${slug}`), branch: `feat/${slug}` };
}

/** Main checkout = parent of the shared git dir (works from inside any worktree). */
export async function mainCheckout(cwd: string, git: GitRunner = defaultGit): Promise<string> {
  // No --path-format=absolute: it needs git >= 2.31 and the output may be relative to cwd.
  const common = await git(["rev-parse", "--git-common-dir"], cwd);
  return path.dirname(path.resolve(cwd, common));
}

/**
 * Branch worktrees start from and merge back into: `AT_BASE_BRANCH`, else origin's HEAD, else
 * `main` / `master` when present, else whatever the main checkout has checked out.
 */
export async function detectBaseBranch(
  root: string,
  git: GitRunner = defaultGit,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  const forced = env.AT_BASE_BRANCH?.trim();
  if (forced) return forced;
  const attempt = async (args: string[]): Promise<string> => {
    try {
      return await git(args, root);
    } catch {
      return "";
    }
  };
  const origin = (await attempt(["symbolic-ref", "--short", "refs/remotes/origin/HEAD"])).replace(/^origin\//, "");
  if (origin) return origin;
  for (const name of ["main", "master"]) {
    if (await attempt(["rev-parse", "--verify", "--quiet", `refs/heads/${name}`])) return name;
  }
  return (await attempt(["rev-parse", "--abbrev-ref", "HEAD"])) || "main";
}

/**
 * Create (or reuse) the isolated worktree for a task, branched off the base branch. Reuse makes a
 * crashed/resumed task continue in the tree it already edited.
 */
export async function ensureTaskWorktree(
  cwd: string,
  taskId: string,
  git: GitRunner = defaultGit,
): Promise<TaskWorktree> {
  const root = await mainCheckout(cwd, git);
  const plan = taskWorktreePlan(root, taskId);
  if (!existsSync(plan.path)) {
    const branches = await git(["branch", "--list", plan.branch], root);
    // Branch left over from an earlier worktree: re-attach it instead of failing on `-b`.
    const args = branches
      ? ["worktree", "add", plan.path, plan.branch]
      : ["worktree", "add", plan.path, "-b", plan.branch, await detectBaseBranch(root, git)];
    await git(args, root);
    shareNodeModules(root, plan.path);
  }
  return plan;
}

/** Same as scripts/worktree-new.sh: reuse the main checkout's installed deps instead of reinstalling. */
function shareNodeModules(root: string, wtPath: string): void {
  const src = path.join(root, "node_modules");
  const dst = path.join(wtPath, "node_modules");
  if (!existsSync(src) || existsSync(dst)) return;
  try {
    symlinkSync(src, dst, "dir");
  } catch {
    // deps are a convenience; the test gate will say if they are missing
  }
}

export interface MergeResult {
  ok: boolean;
  output: string;
}

/** Hook for merging a finished task worktree; tests inject a fake. */
export type MergeRunner = (wt: TaskWorktree, mainRoot: string) => Promise<MergeResult>;

/** Delegates to a project's own scripts/merge-worktree.sh (rebase + ff-merge + cleanup, loud failure). */
export const mergeViaScript: MergeRunner = async (wt, mainRoot) => {
  try {
    const { stdout } = await execFileAsync(
      "bash",
      [path.join(mainRoot, "scripts/merge-worktree.sh"), wt.path, wt.branch],
      { cwd: mainRoot },
    );
    return { ok: stdout.includes("MERGED"), output: stdout.trim() };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    return { ok: false, output: `${e.stdout ?? ""}${e.stderr ?? e.message ?? ""}`.trim() };
  }
};

/**
 * Built-in equivalent of scripts/merge-worktree.sh for projects without one: clean tree check,
 * rebase onto base, ff-only merge from the main checkout, then remove worktree + branch.
 * Every failure is a distinct code and leaves the worktree/branch intact.
 */
export async function mergeNative(
  wt: TaskWorktree,
  mainRoot: string,
  git: GitRunner = defaultGit,
  env: NodeJS.ProcessEnv = process.env,
): Promise<MergeResult> {
  const fail = (code: string, err?: unknown): MergeResult => ({
    ok: false,
    output: err instanceof Error ? `${code}: ${err.message}`.trim() : code,
  });
  const base = await detectBaseBranch(mainRoot, git, env);
  if (await git(["status", "--porcelain"], wt.path)) return fail("DIRTY_WORKTREE");
  try {
    await git(["rebase", base], wt.path);
  } catch (err) {
    await git(["rebase", "--abort"], wt.path).catch(() => "");
    return fail("REBASE_CONFLICT", err);
  }
  // ff-merge happens in the main checkout, which must be sitting on the base branch.
  if ((await git(["rev-parse", "--abbrev-ref", "HEAD"], mainRoot)) !== base) return fail(`MAIN_NOT_ON_${base}`);
  try {
    await git(["merge", "--ff-only", wt.branch], mainRoot);
  } catch (err) {
    return fail("MERGE_FAIL", err);
  }
  try {
    await git(["worktree", "remove", wt.path], mainRoot);
    await git(["branch", "-d", wt.branch], mainRoot);
    await git(["worktree", "prune"], mainRoot);
  } catch (err) {
    // Merged is merged — a stuck cleanup must not fail the task.
    return { ok: true, output: `MERGED (cleanup incomplete: ${err instanceof Error ? err.message : String(err)})` };
  }
  return { ok: true, output: "MERGED" };
}

/** Project script when it exists (it may carry project-specific steps), else the built-in merge. */
export const mergeWorktree: MergeRunner = (wt, mainRoot) =>
  existsSync(path.join(mainRoot, "scripts/merge-worktree.sh"))
    ? mergeViaScript(wt, mainRoot)
    : mergeNative(wt, mainRoot);
