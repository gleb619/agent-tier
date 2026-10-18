import { execFile as _execFile } from "node:child_process";
import { existsSync } from "node:fs";
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
  const common = await git(["rev-parse", "--path-format=absolute", "--git-common-dir"], cwd);
  return path.dirname(common);
}

/**
 * Create (or reuse) the isolated worktree for a task, branched off main. Reuse makes a
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
      : ["worktree", "add", plan.path, "-b", plan.branch, "main"];
    await git(args, root);
  }
  return plan;
}

/** Hook for merging a finished task worktree; tests inject a fake. */
export type MergeRunner = (wt: TaskWorktree, mainRoot: string) => Promise<{ ok: boolean; output: string }>;

/** Delegates to scripts/merge-worktree.sh (rebase + ff-merge + cleanup, loud failure). */
export const mergeViaScript: MergeRunner = async (wt, mainRoot) => {
  try {
    const { stdout } = await execFileAsync(
      "bash",
      [path.join(mainRoot, "scripts/merge-worktree.sh"), wt.path, wt.branch],
      {
        cwd: mainRoot,
      },
    );
    return { ok: stdout.includes("MERGED"), output: stdout.trim() };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    return { ok: false, output: `${e.stdout ?? ""}${e.stderr ?? e.message ?? ""}`.trim() };
  }
};
