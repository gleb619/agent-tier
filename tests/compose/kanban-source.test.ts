import { type ChildProcess, spawn, spawnSync } from "child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createKanbanSource, type KanbanSource } from "../../src/compose/kanban-source";
import { loadBoard, toTasks } from "../../src/kanban/board";
import { getLockDir, pathToLockName } from "../../src/lock";
import { isPidAlive } from "../../src/process-utils";
import { cleanupTmpDirs, makeTmpDir, row, writeBoard } from "../kanban/helpers";

let dir: string;
let boardFile: string;
let logs: string[];
let children: ChildProcess[] = [];

/** Where lock.ts puts the per-task claim lease for `id` on this board. */
function leaseOf(board: string, id: string): string {
  return path.join(getLockDir(board), pathToLockName(`${board}.claim-${id}`));
}

function writeLease(board: string, id: string, pid: number): string {
  const file = leaseOf(board, id);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(
    file,
    JSON.stringify({ pid, hostname: os.hostname(), startedAt: new Date().toISOString(), stateFile: board }),
  );
  return file;
}

/** spawnSync waits for and reaps the child, so its pid is certainly dead. */
function deadPid(): number {
  const pid = spawnSync(process.execPath, ["-e", ""]).pid!;
  expect(isPidAlive(pid)).toBe(false);
  return pid;
}

function livePid(): number {
  const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], { stdio: "ignore" });
  children.push(child);
  expect(isPidAlive(child.pid!)).toBe(true);
  return child.pid!;
}

function statusOf(id: string): string {
  const task = toTasks(loadBoard(boardFile)).find((t) => t.ID === id);
  return task?.Status ?? "";
}

function planFileOf(id: string): string {
  const task = toTasks(loadBoard(boardFile)).find((t) => t.ID === id);
  return task?.["Plan File"] ?? "";
}

function sourceFor(file: string, statusMap?: Record<string, string>): KanbanSource {
  return createKanbanSource({ boardFile: file, statusMap, log: (m) => logs.push(m) });
}

beforeEach(() => {
  dir = makeTmpDir();
  logs = [];
});

afterEach(() => {
  for (const child of children) child.kill();
  children = [];
  cleanupTmpDirs();
  rmSync(dir, { recursive: true, force: true });
});

describe("kanban source — claim", () => {
  it("claims the next executable task and marks it In Progress", async () => {
    boardFile = writeBoard(dir, [row("T1", "Backlog", "first", { priority: "High" }), row("T2", "Backlog", "second")]);

    const task = await sourceFor(boardFile).claim();

    expect(task?.id).toBe("T1");
    expect(task?.title).toBe("first");
    expect(statusOf("T1")).toBe("In Progress");
    expect(statusOf("T2")).toBe("Backlog");
    expect(JSON.parse(readFileSync(leaseOf(boardFile, "T1"), "utf8")).pid).toBe(process.pid);
  });

  it("resumes an In Progress task when nothing else is executable", async () => {
    boardFile = writeBoard(dir, [row("T1", "In Progress", "current one"), row("T2", "Blocked", "other")]);

    const task = await sourceFor(boardFile).claim();

    expect(task?.id).toBe("T1");
    expect(statusOf("T1")).toBe("In Progress");
  });

  it("returns null when nothing is executable", async () => {
    boardFile = writeBoard(dir, [row("T1", "Done", "done"), row("T2", "Blocked", "blocked")]);

    expect(await sourceFor(boardFile).claim()).toBeNull();
  });

  it("never returns the same task from two concurrent claims (lock)", async () => {
    boardFile = writeBoard(dir, [
      row("T1", "Backlog", "one"),
      row("T2", "Backlog", "two"),
      row("T3", "Backlog", "three"),
    ]);
    const src = sourceFor(boardFile);

    const [a, b] = await Promise.all([src.claim(), src.claim()]);

    expect(a?.id).toBeTruthy();
    expect(b?.id).toBeTruthy();
    expect(a?.id).not.toBe(b?.id);
  });

  it("claimId claims a specific task by id", async () => {
    boardFile = writeBoard(dir, [row("T1", "Backlog", "one"), row("T2", "Backlog", "two")]);

    const task = await sourceFor(boardFile).claimId("T2");

    expect(task?.id).toBe("T2");
    expect(statusOf("T2")).toBe("In Progress");
    expect(statusOf("T1")).toBe("Backlog");
    expect(await sourceFor(boardFile).claimId("T9")).toBeNull();
  });

  it("resolves a relative Plan File against the board directory", async () => {
    boardFile = writeBoard(dir, [row("T1", "Backlog", "one", { plan: "plans/t1.md" })]);
    mkdirSync(path.join(dir, "docs", "plans"), { recursive: true });
    writeFileSync(path.join(dir, "docs", "plans", "t1.md"), "plan body");

    const task = await sourceFor(boardFile).claim();

    expect(task?.planFile).toBe(path.join(dir, "docs", "plans", "t1.md"));
  });
});

describe("kanban source — per-task claim lease", () => {
  const info = { goalDir: "", round: 1 };

  beforeEach(() => {
    info.goalDir = path.join(dir, "goal");
  });

  it("resumes an abandoned In Progress task before a higher-priority Backlog task", async () => {
    boardFile = writeBoard(dir, [
      row("T1", "In Progress", "crashed run", { priority: "Low" }),
      row("T2", "Backlog", "fresh work", { priority: "High" }),
    ]);

    const task = await sourceFor(boardFile).claim();

    expect(task?.id).toBe("T1");
    expect(statusOf("T1")).toBe("In Progress");
    expect(statusOf("T2")).toBe("Backlog");
    expect(JSON.parse(readFileSync(leaseOf(boardFile, "T1"), "utf8")).pid).toBe(process.pid);
  });

  it("steals a lease whose pid is dead and resumes that task", async () => {
    boardFile = writeBoard(dir, [
      row("T1", "In Progress", "crashed run", { priority: "Low" }),
      row("T2", "Backlog", "fresh work", { priority: "High" }),
    ]);
    writeLease(boardFile, "T1", deadPid());

    expect(await sourceFor(boardFile).claim()).toMatchObject({ id: "T1" });
    expect(statusOf("T2")).toBe("Backlog");
  });

  it("never hands a live-leased task to a second claim", async () => {
    boardFile = writeBoard(dir, [row("T1", "Backlog", "one", { priority: "High" }), row("T2", "Backlog", "two")]);
    const src = sourceFor(boardFile);

    expect((await src.claim())?.id).toBe("T1");
    expect((await src.claim())?.id).toBe("T2");
    // Both are In Progress and leased by this process: nothing left to claim.
    expect(await src.claim()).toBeNull();
  });

  it("skips a Backlog task leased by another live process", async () => {
    boardFile = writeBoard(dir, [row("T1", "Backlog", "one", { priority: "High" }), row("T2", "Backlog", "two")]);
    writeLease(boardFile, "T1", livePid());

    const task = await sourceFor(boardFile).claim();

    expect(task?.id).toBe("T2");
    expect(statusOf("T1")).toBe("Backlog");
  });

  it("claims five distinct tasks from five concurrent claims", async () => {
    boardFile = writeBoard(dir, [
      row("T1", "Backlog", "a"),
      row("T2", "Backlog", "b"),
      row("T3", "Backlog", "c"),
      row("T4", "Backlog", "d"),
      row("T5", "Backlog", "e"),
    ]);
    const src = sourceFor(boardFile);

    const tasks = await Promise.all([src.claim(), src.claim(), src.claim(), src.claim(), src.claim()]);

    expect(tasks).toHaveLength(5);
    expect(tasks.filter((t) => t === null)).toHaveLength(0);
    expect(new Set(tasks.map((t) => t?.id)).size).toBe(5);
  });

  it("onFinish releases the lease on DONE and FAILED", async () => {
    boardFile = writeBoard(dir, [row("T1", "Backlog", "one"), row("T2", "Backlog", "two")]);
    const src = sourceFor(boardFile);

    const first = (await src.claim())!;
    await src.onFinish(first, "DONE", info);
    expect(existsSync(leaseOf(boardFile, "T1"))).toBe(false);

    const second = (await src.claim())!;
    await src.onFinish(second, "FAILED", info);
    expect(existsSync(leaseOf(boardFile, "T2"))).toBe(false);
    expect(statusOf("T2")).toBe("Blocked");
  });

  it("releases the lease even when the mapped status is missing from the legend", async () => {
    boardFile = writeBoard(dir, [row("T1", "Backlog", "one")]);
    const src = sourceFor(boardFile, { DONE: "Nonexistent" });

    const task = (await src.claim())!;
    await src.onFinish(task, "DONE", info);

    expect(existsSync(leaseOf(boardFile, "T1"))).toBe(false);
  });

  it("claimId on a live-leased task returns null and warns with the holder pid", async () => {
    boardFile = writeBoard(dir, [row("T1", "Backlog", "one")]);
    const pid = livePid();
    writeLease(boardFile, "T1", pid);

    expect(await sourceFor(boardFile).claimId("T1")).toBeNull();
    expect(logs.some((m) => m.includes(`task T1 is claimed by pid ${pid}`))).toBe(true);
    expect(statusOf("T1")).toBe("Backlog");
  });

  it("claimId takes the lease, onFinish frees it for the next claimId", async () => {
    boardFile = writeBoard(dir, [row("T1", "Backlog", "one")]);
    const src = sourceFor(boardFile);

    const task = (await src.claimId("T1"))!;
    expect(await src.claimId("T1")).toBeNull();

    await src.onFinish(task, "DONE", info);

    expect((await src.claimId("T1"))?.id).toBe("T1");
    expect(statusOf("T1")).toBe("In Progress");
  });
});

describe("kanban source — onFinish", () => {
  const info = { goalDir: "", round: 2 };

  beforeEach(() => {
    boardFile = writeBoard(dir, [row("T1", "In Progress", "the task")]);
    info.goalDir = mkdtempSync(path.join(os.tmpdir(), "at-compose-out-"));
  });

  afterEach(() => {
    rmSync(info.goalDir, { recursive: true, force: true });
  });

  it("DONE marks the task Done", async () => {
    const task = (await sourceFor(boardFile).claim())!;

    await sourceFor(boardFile).onFinish(task, "DONE", info);

    expect(statusOf("T1")).toBe("Done");
    expect(existsSync(path.join(info.goalDir, "outcome.md"))).toBe(false);
  });

  it("FAILED marks the task Blocked and writes outcome.md", async () => {
    const task = (await sourceFor(boardFile).claim())!;

    await sourceFor(boardFile).onFinish(task, "FAILED", info);

    expect(statusOf("T1")).toBe("Blocked");
    const outcome = readFileSync(path.join(info.goalDir, "outcome.md"), "utf8");
    expect(outcome).toContain("T1");
    expect(outcome).toContain("FAILED");
  });

  it("FAILED sets Plan File only when it is currently -", async () => {
    const plain = sourceFor(boardFile);
    const task = (await plain.claim())!;
    await plain.onFinish(task, "FAILED", info);
    expect(planFileOf("T1")).toBe(path.join(info.goalDir, "plan.md"));

    boardFile = writeBoard(dir, [row("T1", "In Progress", "the task", { plan: "docs/plans/custom.md" })]);
    const task2 = (await sourceFor(boardFile).claim())!;
    await sourceFor(boardFile).onFinish(task2, "FAILED", info);
    expect(planFileOf("T1")).toBe("docs/plans/custom.md");
  });

  it("skips a mapped status missing from the legend and warns instead of throwing", async () => {
    const src = sourceFor(boardFile, { DONE: "Nonexistent" });
    const task = (await src.claim())!;

    await src.onFinish(task, "DONE", info);

    expect(statusOf("T1")).toBe("In Progress");
    expect(logs.some((m) => m.includes("Nonexistent"))).toBe(true);
  });

  it("warns and skips claim when the claim status is not in the legend", async () => {
    const src = sourceFor(boardFile, { claim: "Doing" });

    expect(await src.claim()).toBeNull();
    expect(logs.some((m) => m.includes("Doing"))).toBe(true);
  });
});
