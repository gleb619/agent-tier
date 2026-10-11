import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { type GitRunner, guardKanban, spawnGit } from "../../src/kanban/guard";
import { cleanupTmpDirs, makeTmpDir, writeText } from "./helpers";

afterEach(cleanupTmpDirs);

function boardText(ids: string[], pad = ""): string {
  return [`| ID${pad} | Status |`, "| :-- | :-- |", ...ids.map((id) => `| ${id}${pad} | Done |`), ""].join("\n");
}

function fakeGit(base: string, log = ""): { runner: GitRunner; calls: string[][] } {
  const calls: string[][] = [];
  const runner: GitRunner = (args) => {
    calls.push(args);
    if (args[0] === "show") return base;
    if (args[0] === "log") return log;
    return "";
  };
  return { runner, calls };
}

function repo(headIds: string[] | null): string {
  const cwd = makeTmpDir();
  if (headIds !== null) writeText(path.join(cwd, "docs", "kanban.md"), boardText(headIds));
  return cwd;
}

describe("guardKanban", () => {
  it("passes when no row ID was dropped", () => {
    const cwd = repo(["T1", "T2", "T3"]);
    const { runner } = fakeGit(boardText(["T1", "T2"]));
    const r = guardKanban("abc123", cwd, { git: runner });
    expect(r).toEqual({ ok: true, missing: [], rewrite: false, baseIds: 2, headIds: 3 });
  });

  it("fails when an ID present at base is gone at HEAD (I10)", () => {
    const cwd = repo(["T1", "T3"]);
    const { runner } = fakeGit(boardText(["T1", "T2", "T3"]));
    const r = guardKanban("abc123", cwd, { git: runner });
    expect(r.ok).toBe(false);
    expect(r.missing).toEqual(["T2"]);
    expect(r.rewrite).toBe(false);
  });

  it("accepts a deliberate rewrite carrying the [kanban-rewrite] trailer", () => {
    const cwd = repo(["T1"]);
    const { runner } = fakeGit(boardText(["T1", "T2"]), "chore(kanban): prune stale rows\n\n[kanban-rewrite]\n");
    const r = guardKanban("abc123", cwd, { git: runner });
    expect(r.ok).toBe(true);
    expect(r.rewrite).toBe(true);
    expect(r.missing).toEqual(["T2"]);
  });

  it("passes when the base predates the board file", () => {
    const cwd = repo(["T1"]);
    const { runner } = fakeGit("");
    const r = guardKanban("abc123", cwd, { git: runner });
    expect(r.ok).toBe(true);
    expect(r.baseIds).toBe(0);
  });

  it("treats a missing HEAD board as empty text", () => {
    const cwd = repo(null);
    const { runner } = fakeGit(boardText(["T1", "T2"]));
    const r = guardKanban("abc123", cwd, { git: runner });
    expect(r.ok).toBe(false);
    expect(r.missing).toEqual(["T1", "T2"]);
    expect(r.headIds).toBe(0);
  });

  it("lists every dropped ID in sorted order", () => {
    const cwd = repo(["T2"]);
    const { runner } = fakeGit(boardText(["T10", "T2", "T9", "T1"]));
    const r = guardKanban("abc123", cwd, { git: runner });
    expect(r.missing).toEqual(["T1", "T10", "T9"]);
  });

  it("is immune to column re-padding — same IDs, different whitespace passes", () => {
    const cwd = repo(["T1", "T2"]);
    writeText(path.join(cwd, "docs", "kanban.md"), boardText(["T1", "T2"], "     "));
    const { runner } = fakeGit(boardText(["T1", "T2"]));
    expect(guardKanban("abc123", cwd, { git: runner }).ok).toBe(true);
  });

  it("asks git for the base blob and the commit log range", () => {
    const cwd = repo(["T1"]);
    const { runner, calls } = fakeGit(boardText(["T1", "T2"]));
    guardKanban("BASE", cwd, { git: runner });
    expect(calls[0]).toEqual(["show", "BASE:docs/kanban.md"]);
    expect(calls[1]).toEqual(["log", "BASE..HEAD", "--format=%B"]);
  });

  it("does not consult the log when nothing is missing", () => {
    const cwd = repo(["T1"]);
    const { runner, calls } = fakeGit(boardText(["T1"]));
    guardKanban("BASE", cwd, { git: runner });
    expect(calls).toHaveLength(1);
  });

  it("honours a custom boardRel", () => {
    const cwd = makeTmpDir();
    writeText(path.join(cwd, "boards", "team.md"), boardText(["T1"]));
    const { runner, calls } = fakeGit(boardText(["T1", "T5"]));
    const r = guardKanban("BASE", cwd, { boardRel: "boards/team.md", git: runner });
    expect(calls[0]).toEqual(["show", "BASE:boards/team.md"]);
    expect(r.missing).toEqual(["T5"]);
  });

  it("never throws when every git call fails", () => {
    const cwd = repo(null);
    const runner: GitRunner = () => "";
    expect(() => guardKanban("BASE", cwd, { git: runner })).not.toThrow();
    expect(guardKanban("BASE", cwd, { git: runner }).ok).toBe(true);
  });

  it("defaults to docs/kanban.md with the real spawnGit runner", () => {
    const cwd = repo(["T1"]);
    expect(() => guardKanban("this-ref-does-not-exist", cwd)).not.toThrow();
    expect(guardKanban("this-ref-does-not-exist", cwd).ok).toBe(true);
  });
});

describe("spawnGit", () => {
  it("returns empty string on a nonzero exit instead of throwing", () => {
    expect(spawnGit(["show", "no-such-ref:no-such-file"], process.cwd())).toBe("");
  });

  it("returns stdout on success", () => {
    expect(spawnGit(["rev-parse", "--is-inside-work-tree"], process.cwd()).trim()).toBe("true");
  });
});
