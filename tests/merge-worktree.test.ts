import { execSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const script = join(__dirname, "..", "scripts", "merge-worktree.sh");
const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@t",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@t",
};

function sh(cmd: string, cwd: string): string {
  return execSync(cmd, { cwd, env: GIT_ENV, stdio: "pipe" }).toString();
}

const roots: string[] = [];

/** Temp git repo on `main` plus a linked worktree on `feature` with one committed change to file.txt. */
function setup(): { repo: string; wt: string } {
  const root = mkdtempSync(join(tmpdir(), "mw-"));
  roots.push(root);
  const repo = join(root, "repo");
  mkdirSync(repo);
  sh("git init -q", repo);
  sh("git checkout -q -b main", repo);
  writeFileSync(join(repo, "file.txt"), "initial\n");
  sh("git add . && git commit -qm init", repo);
  const wt = join(root, "wt");
  sh(`git worktree add -q ${wt} -b feature`, repo);
  writeFileSync(join(wt, "file.txt"), "feature\n");
  sh("git commit -qam feature", wt);
  return { repo, wt };
}

afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

describe("merge-worktree.sh", () => {
  it("rebases, ff-merges, then removes worktree and branch", () => {
    const { repo, wt } = setup();
    const out = sh(`bash ${script} ${wt} feature`, repo);
    expect(out).toContain("MERGED");
    expect(existsSync(wt)).toBe(false);
    expect(sh("git branch", repo)).not.toContain("feature");
    expect(sh("git log --oneline", repo)).toContain("feature");
  });

  it("refuses a dirty worktree and keeps it", () => {
    const { repo, wt } = setup();
    writeFileSync(join(wt, "new.txt"), "untracked\n");
    expect(() => sh(`bash ${script} ${wt} feature`, repo)).toThrow();
    expect(existsSync(wt)).toBe(true);
    expect(sh("git branch", repo)).toContain("feature");
  });

  it("exits non-zero on rebase conflict and keeps worktree", () => {
    const { repo, wt } = setup();
    writeFileSync(join(repo, "file.txt"), "main change\n");
    sh("git commit -qam main-change", repo);
    expect(() => sh(`bash ${script} ${wt} feature`, repo)).toThrow();
    expect(existsSync(wt)).toBe(true);
    expect(sh("git branch", repo)).toContain("feature");
  });
});
