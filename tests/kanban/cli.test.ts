import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  boardMarkdown,
  cleanupTmpDirs,
  makeTmpDir,
  readBoard,
  row,
  stateMachineRows,
  writeBoard,
  writeText,
} from "./helpers";

const ROOT = path.resolve(__dirname, "..", "..");
const CLI = path.join(ROOT, "dist", "cli.js");

function at(...args: string[]): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, [CLI, "kanban", ...args], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, AT_KANBAN_FILE: "" },
  });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

function board(rows: string[][] = stateMachineRows()): string {
  return writeBoard(makeTmpDir(), rows);
}

function json(stdout: string): unknown {
  return JSON.parse(stdout);
}

beforeAll(() => {
  if (!existsSync(CLI)) {
    spawnSync("npm", ["run", "build"], { cwd: ROOT, encoding: "utf8" });
  }
});

afterAll(cleanupTmpDirs);

describe.skipIf(!existsSync(CLI))("at kanban CLI", () => {
  it("--help lists every subcommand", () => {
    const r = at("--help");
    expect(r.status).toBe(0);
    for (const cmd of ["list", "next", "show", "add", "status", "remove", "clean", "lint", "guard", "init"]) {
      expect(r.stdout).toContain(cmd);
    }
  });

  it("fails on an unknown subcommand", () => {
    expect(at("nope").status).not.toBe(0);
  });

  describe("list", () => {
    it("prints one line per row", () => {
      const file = board();
      const r = at("list", file);
      expect(r.status).toBe(0);
      expect(r.stdout.trim().split("\n")).toHaveLength(5);
      expect(r.stdout).toContain("T5");
    });

    it("--json emits a parseable tasks array", () => {
      const file = board();
      const r = at("list", file, "--json");
      expect(r.status).toBe(0);
      const payload = json(r.stdout) as { file: string; tasks: unknown[] };
      expect(payload.file).toBe(file);
      expect(payload.tasks).toHaveLength(5);
    });
  });

  describe("next", () => {
    it("returns the In Progress task on the state-machine fixture", () => {
      const file = board();
      const payload = json(at("next", file, "--json").stdout) as {
        selection: { type: string; task: { ID: string } };
      };
      expect(payload.selection.type).toBe("current");
      expect(payload.selection.task.ID).toBe("T5");
    });

    it("--start mutates the board on disk", () => {
      const file = board([row("T1", "Backlog", "a", { priority: "High" }), row("T2", "Backlog", "b")]);
      const r = at("next", file, "--start");
      expect(r.status).toBe(0);
      expect(r.stdout).toContain("Marked T1 as In Progress.");
      expect(readBoard(file)).toMatch(/\|\s*T1\s*\|\s*In Progress\s*\|/);
    });

    it("--start is a no-op when a task is already In Progress", () => {
      const file = board();
      const r = at("next", file, "--start");
      expect(r.status).toBe(0);
      expect(r.stdout).not.toContain("Marked");
      expect(readBoard(file)).toMatch(/\|\s*T5\s*\|\s*In Progress\s*\|/);
    });

    it("reports no executable task on an exhausted board", () => {
      const file = board([row("T1", "Done", "a")]);
      expect(at("next", file).stdout).toContain("No executable task found.");
    });
  });

  describe("show", () => {
    it("prints the field block", () => {
      const file = board([row("T1", "Backlog", "a title", { priority: "High" })]);
      const r = at("show", "T1", file);
      expect(r.status).toBe(0);
      expect(r.stdout).toContain("==> Task T1");
      expect(r.stdout).toMatch(/Priority:\s+High/);
    });

    it("exits 1 with [at] error on an unknown ID", () => {
      const file = board([row("T1", "Backlog", "a")]);
      const r = at("show", "T99", file);
      expect(r.status).toBe(1);
      expect(r.stderr).toContain("[at] error: Task T99 not found");
    });

    it("--with-plan previews the linked plan", () => {
      const dir = makeTmpDir();
      writeText(path.join(dir, "docs", "plans", "T1-spec.md"), "# the spec\n");
      const file = writeBoard(dir, [row("T1", "Backlog", "a", { plan: "plans/T1-spec.md" })]);
      const r = at("show", "T1", file, "--with-plan");
      expect(r.stdout).toContain("==> Plan preview");
      expect(r.stdout).toContain("# the spec");
    });
  });

  describe("add", () => {
    it("adds a row and reports it", () => {
      const file = board([]);
      const r = at("add", file, "--title", "brand new", "--priority", "High");
      expect(r.status).toBe(0);
      expect(r.stdout).toContain("Added T1: brand new");
      expect(readBoard(file)).toContain("brand new");
    });

    it("--json prints JSON only", () => {
      const file = board([]);
      const r = at("add", file, "--title", "x", "--json");
      expect(r.status).toBe(0);
      const payload = json(r.stdout) as { id: string; updated: boolean };
      expect(payload).toMatchObject({ id: "T1", updated: false });
    });

    it("upserts an existing ID without touching Status", () => {
      const file = board([row("T1", "In Progress", "old")]);
      const r = at("add", file, "--id", "T1", "--title", "new");
      expect(r.stdout).toContain("Updated T1: new");
      expect(readBoard(file)).toMatch(/\|\s*T1\s*\|\s*In Progress\s*\|/);
    });

    it("warns on stderr when the description is over-long", () => {
      const file = board([]);
      const r = at("add", file, "--title", "x", "--description", "a".repeat(200));
      expect(r.status).toBe(0);
      expect(r.stderr).toContain("[kanban-add] DESCRIPTION exceeds 128 characters");
    });

    it("exits 1 on an invalid priority", () => {
      const file = board([]);
      const r = at("add", file, "--title", "x", "--priority", "Urgent");
      expect(r.status).toBe(1);
      expect(r.stderr).toContain("[at] error: Invalid priority");
    });

    it("accepts --blocked-by and --plan", () => {
      const file = board([row("T1", "Done", "a")]);
      at("add", file, "--id", "T2", "--title", "b", "--blocked-by", "T1", "--plan", "p.md");
      const r = at("show", "T2", file);
      expect(r.stdout).toMatch(/Blocked By:\s+T1/);
      expect(r.stdout).toMatch(/Plan File:\s+p\.md/);
    });
  });

  describe("status", () => {
    it("changes the status", () => {
      const file = board([row("T1", "Backlog", "a")]);
      const r = at("status", "T1", "Done", file);
      expect(r.status).toBe(0);
      expect(r.stdout).toContain("Updated T1 -> Done");
      expect(readBoard(file)).toMatch(/\|\s*T1\s*\|\s*Done\s*\|/);
    });

    it("exits 1 on an invalid status", () => {
      const file = board([row("T1", "Backlog", "a")]);
      const r = at("status", "T1", "Doing", file);
      expect(r.status).toBe(1);
      expect(r.stderr).toContain("Invalid status. Allowed: Backlog, In Progress, Blocked, Done");
    });
  });

  describe("remove / clean", () => {
    it("remove deletes the row, and rm is an alias", () => {
      const file = board([row("T1", "Done", "a"), row("T2", "Done", "b")]);
      expect(at("remove", "T1", file).stdout).toContain("Removed T1");
      expect(at("rm", "T2", file).stdout).toContain("Removed T2");
      expect(readBoard(file)).not.toContain("T1");
    });

    it("remove exits 1 for an unknown ID", () => {
      expect(at("remove", "T9", board([row("T1", "Done", "a")])).status).toBe(1);
    });

    it("clean drops every Done row", () => {
      const file = board([row("T1", "Done", "a"), row("T2", "Backlog", "b")]);
      const r = at("clean", file);
      expect(r.stdout).toContain("Removed done tasks: T1");
      expect(readBoard(file)).not.toMatch(/\|\s*T1\s*\|/);
      expect(readBoard(file)).toMatch(/\|\s*T2\s*\|/);
    });

    it("clean --json reports the removed IDs", () => {
      const file = board([row("T1", "Done", "a"), row("T2", "Done", "b")]);
      const payload = json(at("clean", file, "--json").stdout) as { removed: string[] };
      expect(payload.removed).toEqual(["T1", "T2"]);
    });
  });

  describe("lint", () => {
    it("exits 0 on a clean board", () => {
      const file = board([row("T1", "Backlog", "a")]);
      const r = at("lint", file);
      expect(r.status).toBe(0);
      expect(r.stdout).toContain("1 rows — IDs unique, statuses valid, plan files resolve");
    });

    it("exits 1 and lists violations on a broken board", () => {
      const dir = makeTmpDir();
      const file = writeText(
        path.join(dir, "docs", "kanban.md"),
        boardMarkdown([row("T1", "Doing", "a"), row("T1", "Done", "dup")]),
      );
      const r = at("lint", file);
      expect(r.status).toBe(1);
      expect(r.stderr).toContain("invalid Status 'Doing'");
      expect(r.stderr).toContain("duplicate ID T1");
      expect(r.stderr).toContain("2 violation(s) found");
    });

    it("--json reports structured violations", () => {
      const dir = makeTmpDir();
      const file = writeText(path.join(dir, "docs", "kanban.md"), boardMarkdown([row("T1", "Doing", "a")]));
      const r = at("lint", file, "--json");
      expect(r.status).toBe(1);
      const payload = json(r.stdout) as {
        rows: number;
        legend: string[];
        violations: { line: number; message: string }[];
      };
      expect(payload.rows).toBe(1);
      expect(payload.legend).toContain("Done");
      expect(payload.violations[0].message).toContain("invalid Status 'Doing'");
    });
  });

  describe("--board and the [file] positional", () => {
    it("both select the board, positional winning", () => {
      const a = board([row("T1", "Done", "from-a")]);
      const b = board([row("T2", "Done", "from-b")]);
      expect(at("list", "--board", a).stdout).toContain("from-a");
      expect(at("list", b, "--board", a).stdout).toContain("from-b");
    });

    it("exits 1 when the board file does not exist", () => {
      const r = at("list", "/tmp/definitely-not-a-board-file.md");
      expect(r.status).toBe(1);
      expect(r.stderr).toContain("[at] error:");
    });
  });

  describe("init", () => {
    it("scaffolds a board that immediately passes lint", () => {
      const dir = makeTmpDir();
      const file = path.join(dir, "docs", "kanban.md");
      expect(at("init", file).status).toBe(0);
      expect(existsSync(file)).toBe(true);
      expect(at("lint", file).status).toBe(0);
    });

    it("refuses to overwrite without --force and allows it with --force", () => {
      const dir = makeTmpDir();
      const file = path.join(dir, "docs", "kanban.md");
      at("init", file);
      const again = at("init", file);
      expect(again.status).toBe(1);
      expect(again.stderr).toContain("already exists");
      expect(at("init", file, "--force").status).toBe(0);
    });
  });

  describe("guard", () => {
    it("passes on a clean history and fails on a dropped ID", () => {
      const dir = makeTmpDir();
      const git = (...args: string[]) => spawnSync("git", args, { cwd: dir, encoding: "utf8" });

      git("init", "-q");
      git("config", "user.email", "test@example.com");
      git("config", "user.name", "test");
      writeBoard(dir, [row("T1", "Done", "a"), row("T2", "Done", "b")]);
      git("add", "-A");
      git("commit", "-q", "-m", "seed board");
      const base = git("rev-parse", "HEAD").stdout.trim();

      const clean = spawnSync(process.execPath, [CLI, "kanban", "guard", base], {
        cwd: dir,
        encoding: "utf8",
      });
      expect(clean.status).toBe(0);
      expect(clean.stdout).toContain("no row IDs dropped since");

      writeBoard(dir, [row("T1", "Done", "a")]);
      git("add", "-A");
      git("commit", "-q", "-m", "drop T2 by accident");
      const dropped = spawnSync(process.execPath, [CLI, "kanban", "guard", base], {
        cwd: dir,
        encoding: "utf8",
      });
      expect(dropped.status).toBe(1);
      expect(dropped.stderr).toContain("T2");

      git("commit", "-q", "--allow-empty", "-m", "chore(kanban): prune\n\n[kanban-rewrite]");
      const acknowledged = spawnSync(process.execPath, [CLI, "kanban", "guard", base], {
        cwd: dir,
        encoding: "utf8",
      });
      expect(acknowledged.status).toBe(0);
      expect(acknowledged.stderr).toContain("deliberate rewrite accepted");
    });

    it("--json reports the guard result", () => {
      const dir = makeTmpDir();
      const git = (...args: string[]) => spawnSync("git", args, { cwd: dir, encoding: "utf8" });
      git("init", "-q");
      git("config", "user.email", "test@example.com");
      git("config", "user.name", "test");
      writeBoard(dir, [row("T1", "Done", "a")]);
      git("add", "-A");
      git("commit", "-q", "-m", "seed");
      const base = git("rev-parse", "HEAD").stdout.trim();

      const r = spawnSync(process.execPath, [CLI, "kanban", "guard", base, "--json"], {
        cwd: dir,
        encoding: "utf8",
      });
      const payload = JSON.parse(r.stdout) as { ok: boolean; baseIds: number };
      expect(payload.ok).toBe(true);
      expect(payload.baseIds).toBe(1);
    });
  });
});
