import path from "node:path";
import { describe, expect, it } from "vitest";
import { ensureTaskWorktree, type GitRunner, taskWorktreePlan } from "../../src/compose/worktree";

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
