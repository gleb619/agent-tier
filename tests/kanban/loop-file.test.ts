import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ensureComposeFile, ensureLoopFile, kanbanLoopText, loopFilePath } from "../../src/kanban/loop-file";
import { cleanupTmpDirs, makeTmpDir } from "./helpers";

afterEach(cleanupTmpDirs);

describe("loopFilePath", () => {
  it("sits next to the board with a -loop suffix", () => {
    expect(loopFilePath("/p/docs/kanban.md")).toBe("/p/docs/kanban-loop.md");
    expect(loopFilePath("/p/board.md")).toBe("/p/board-loop.md");
  });
});

describe("kanbanLoopText", () => {
  it("carries every state and the compose invocation", () => {
    const text = kanbanLoopText();
    for (const s of ["CHECK", "LINT", "POLL", "PREPARE", "RUN", "REVIEW", "REPORT", "STOP"]) {
      expect(text).toContain(`State: ${s}`);
    }
    expect(text).toContain("at compose --loop --worktree --merge --max-tasks 3 --stop-on-fail");
    expect(text).not.toContain("--board");
  });

  it("threads a non-default board through every kanban call", () => {
    const text = kanbanLoopText({ board: "plans/tasks.md" });
    expect(text).toContain("at kanban lint --board plans/tasks.md");
    expect(text).toContain("/loop 30m plans/tasks-loop.md");
  });
});

describe("ensureLoopFile", () => {
  it("creates the file when missing, creating the directory too", () => {
    const dir = makeTmpDir();
    const board = path.join(dir, "docs", "kanban.md");
    const r = ensureLoopFile(board);
    expect(r.outcome).toBe("created");
    expect(readFileSync(path.join(dir, "docs", "kanban-loop.md"), "utf8")).toContain("# Kanban Loop");
  });

  it("never overwrites an existing file", () => {
    const dir = makeTmpDir();
    const board = path.join(dir, "kanban.md");
    writeFileSync(path.join(dir, "kanban-loop.md"), "mine", "utf8");
    expect(ensureLoopFile(board).outcome).toBe("unchanged");
    expect(readFileSync(path.join(dir, "kanban-loop.md"), "utf8")).toBe("mine");
  });

  it("regenerates with force", () => {
    const dir = makeTmpDir();
    const board = path.join(dir, "kanban.md");
    writeFileSync(path.join(dir, "kanban-loop.md"), "mine", "utf8");
    expect(ensureLoopFile(board, { force: true }).outcome).toBe("created");
    expect(readFileSync(path.join(dir, "kanban-loop.md"), "utf8")).toContain("# Kanban Loop");
  });

  it("skips instead of throwing when the directory is unwritable", () => {
    const dir = makeTmpDir();
    const ro = path.join(dir, "ro");
    mkdirSync(ro);
    chmodSync(ro, 0o500);
    const r = ensureLoopFile(path.join(ro, "kanban.md"));
    chmodSync(ro, 0o700);
    if (process.getuid?.() === 0) return; // root ignores the mode bits
    expect(r.outcome).toBe("skipped");
    expect(r.reason).toBeTruthy();
    expect(existsSync(path.join(ro, "kanban-loop.md"))).toBe(false);
  });
});

describe("ensureComposeFile", () => {
  it("scaffolds a copy of docs/kanban-compose.md and never overwrites", () => {
    const dir = makeTmpDir();
    const board = path.join(dir, "kanban.md");
    expect(ensureComposeFile(board).outcome).toBe("created");
    const repoDoc = readFileSync(path.join(__dirname, "..", "..", "docs", "kanban-compose.md"), "utf8");
    expect(
      readFileSync(path.join(dir, "kanban-compose.md"), "utf8"),
      "docs/kanban-compose.md drifted from src/kanban/compose-doc.ts; run `pnpm run kanban:compose-doc` to regenerate",
    ).toBe(repoDoc);
    writeFileSync(path.join(dir, "kanban-compose.md"), "mine", "utf8");
    expect(ensureComposeFile(board).outcome).toBe("unchanged");
    expect(readFileSync(path.join(dir, "kanban-compose.md"), "utf8")).toBe("mine");
  });
});
