import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  detectBaseBranch,
  ensureTaskWorktree,
  type GitRunner,
  mergeNative,
  mergeWorktree,
  taskWorktreePlan,
} from "../../src/compose/worktree";

describe("compose worktree", () => {
  it("plans a sibling worktree on feat/<id>", () => {
    expect(taskWorktreePlan("/w/agent-tier", "T7")).toEqual({ path: "/w/agent-tier-t7", branch: "feat/t7" });
  });

  it("creates a new branch off main when none exists", async () => {
    const calls: string[][] = [];
    const git: GitRunner = async (args) => {
      calls.push(args);
      if (args[0] === "rev-parse") return "/nonexistent-root/agent-tier/.git";
      return "";
    };
    const wt = await ensureTaskWorktree("/anywhere", "T7", git);
    expect(wt.path).toBe(path.join("/nonexistent-root", "agent-tier-t7"));
    expect(calls.at(-1)).toEqual(["worktree", "add", wt.path, "-b", "feat/t7", "main"]);
  });

  it("re-attaches a leftover branch", async () => {
    const git: GitRunner = async (args) => {
      if (args[0] === "rev-parse") return "/nonexistent-root/agent-tier/.git";
      if (args[0] === "branch") return "  feat/t7";
      return "";
    };
    const calls: string[][] = [];
    await ensureTaskWorktree("/anywhere", "T7", async (a, c) => {
      calls.push(a);
      return git(a, c);
    });
    expect(calls.at(-1)).toEqual(["worktree", "add", "/nonexistent-root/agent-tier-t7", "feat/t7"]);
  });
});

describe("compose worktree — real git, project without scripts/", () => {
  const sh = (cwd: string, ...cmd: string[]) => execFileSync("git", cmd, { cwd, encoding: "utf8" }).trim();

  function initRepo(branch: string): { root: string; cleanup: () => void } {
    const base = mkdtempSync(path.join(os.tmpdir(), "at-wt-"));
    const root = path.join(base, "proj");
    mkdirSync(root);
    sh(root, "init", "-q");
    sh(root, "symbolic-ref", "HEAD", `refs/heads/${branch}`);
    sh(root, "config", "user.email", "t@t");
    sh(root, "config", "user.name", "t");
    writeFileSync(path.join(root, "a.txt"), "a\n");
    sh(root, "add", ".");
    sh(root, "commit", "-q", "-m", "init");
    return { root, cleanup: () => rmSync(base, { recursive: true, force: true }) };
  }

  it("creates the worktree off master and merges it back with the built-in merge", async () => {
    const { root, cleanup } = initRepo("master");
    try {
      const wt = await ensureTaskWorktree(root, "T1");
      expect(wt.branch).toBe("feat/t1");
      writeFileSync(path.join(wt.path, "b.txt"), "b\n");
      sh(wt.path, "add", ".");
      sh(wt.path, "commit", "-q", "-m", "work");

      const res = await mergeWorktree(wt, root);

      expect(res).toEqual({ ok: true, output: "MERGED" });
      expect(existsSync(path.join(root, "b.txt"))).toBe(true);
      expect(existsSync(wt.path)).toBe(false);
      expect(sh(root, "branch", "--list", "feat/t1")).toBe("");
    } finally {
      cleanup();
    }
  });

  it("reports DIRTY_WORKTREE and keeps the worktree", async () => {
    const { root, cleanup } = initRepo("main");
    try {
      const wt = await ensureTaskWorktree(root, "T2");
      writeFileSync(path.join(wt.path, "wip.txt"), "x\n");

      const res = await mergeNative(wt, root);

      expect(res).toEqual({ ok: false, output: "DIRTY_WORKTREE" });
      expect(existsSync(wt.path)).toBe(true);
    } finally {
      cleanup();
    }
  });

  it("reports REBASE_CONFLICT, aborts the rebase and keeps the branch", async () => {
    const { root, cleanup } = initRepo("main");
    try {
      const wt = await ensureTaskWorktree(root, "T3");
      writeFileSync(path.join(wt.path, "a.txt"), "branch\n");
      sh(wt.path, "commit", "-qam", "branch edit");
      writeFileSync(path.join(root, "a.txt"), "main\n");
      sh(root, "commit", "-qam", "main edit");

      const res = await mergeNative(wt, root);

      expect(res.ok).toBe(false);
      expect(res.output).toMatch(/^REBASE_CONFLICT/);
      expect(sh(wt.path, "status", "--porcelain")).toBe("");
      expect(sh(root, "branch", "--list", "feat/t3")).toContain("feat/t3");
    } finally {
      cleanup();
    }
  });

  it("detectBaseBranch honours AT_BASE_BRANCH", async () => {
    expect(await detectBaseBranch("/x", async () => "", { AT_BASE_BRANCH: "trunk" })).toBe("trunk");
  });
});
