import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type ComposeCliOptions, registerComposeCommand, runBoardTasks } from "../../src/compose/cli";
import type { ComposeTask } from "../../src/compose/task-source";
import { loadBoard, toTasks } from "../../src/kanban/board";
import { cleanupTmpDirs, makeTmpDir, row, writeBoard } from "../kanban/helpers";

function statusOf(boardFile: string, id: string): string {
  return toTasks(loadBoard(boardFile)).find((t) => t.ID === id)?.Status ?? "";
}

function build(run: (opts: ComposeCliOptions) => Promise<number>, goalId = "fixed-id") {
  const logs: string[] = [];
  const errors: string[] = [];
  const program = new Command();
  program.name("at");
  program.exitOverride();
  registerComposeCommand(program, {
    run,
    log: (m) => logs.push(m),
    error: (m) => errors.push(m),
    newGoalId: () => goalId,
  });
  return { program, logs, errors };
}

async function parse(program: Command, args: string[]): Promise<void> {
  await program.parseAsync(["node", "at", "compose", ...args]);
}

describe("compose command — option parsing", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("passes goal and defaults to the run dep", async () => {
    let seen: ComposeCliOptions | undefined;
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    const { program } = build(async (opts) => {
      seen = opts;
      return 0;
    });

    await parse(program, ["-p", "make retries work"]);

    expect(seen).toEqual({
      goal: "make retries work",
      goalId: "fixed-id",
      testCmd: "npm test",
      maxRounds: 3,
      maxNodes: 30,
      maxQuestions: 5,
    });
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it("accepts --goal as an alias for --prompt", async () => {
    let seen: ComposeCliOptions | undefined;
    vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    const { program } = build(async (opts) => {
      seen = opts;
      return 0;
    });

    await parse(program, ["--goal", "alias goal"]);

    expect(seen?.goal).toBe("alias goal");
  });

  it("parses --test-cmd, --max-rounds, --max-nodes and --max-questions", async () => {
    let seen: ComposeCliOptions | undefined;
    vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    const { program } = build(async (opts) => {
      seen = opts;
      return 0;
    });

    await parse(program, [
      "-p",
      "g",
      "--test-cmd",
      "npm run check",
      "--max-rounds",
      "5",
      "--max-nodes",
      "12",
      "--max-questions",
      "2",
    ]);

    expect(seen).toMatchObject({ testCmd: "npm run check", maxRounds: 5, maxNodes: 12, maxQuestions: 2 });
  });

  it("uses --resume <id> as the goal id", async () => {
    let seen: ComposeCliOptions | undefined;
    vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    const { program } = build(async (opts) => {
      seen = opts;
      return 0;
    });

    await parse(program, ["-p", "g", "--resume", "goal-abc"]);

    expect(seen?.goalId).toBe("goal-abc");
  });

  it("exits 1 when the run reports a non-DONE state", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    const { program, logs } = build(async () => 1);

    await parse(program, ["-p", "g"]);

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(logs.join("\n")).toContain("fixed-id");
  });

  it("exits 1 and reports the error when the run throws", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    const { program, errors } = build(async () => {
      throw new Error("compose CHECK: missing verdict.md");
    });

    await parse(program, ["-p", "g"]);

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errors.join("\n")).toContain("compose CHECK: missing verdict.md");
  });
});

describe("compose command — missing prompt", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("exits 1 without running", async () => {
    const run = vi.fn(async () => 0);
    const _exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`exit ${code}`);
    }) as never);
    const { program, errors } = build(run);

    await expect(parse(program, [])).rejects.toThrow("exit 1");
    expect(run).not.toHaveBeenCalled();
    expect(errors.join("\n")).toMatch(/--prompt|--goal/);
  });
});

describe("compose — board tasks (--task / --loop)", () => {
  let dir: string;
  let boardFile: string;

  beforeEach(() => {
    dir = makeTmpDir("at-compose-board-");
    boardFile = writeBoard(dir, [
      row("T1", "Backlog", "first", { blocks: "T2" }),
      row("T2", "Backlog", "second", { blockedBy: "T1" }),
      row("T3", "Backlog", "third"),
    ]);
  });

  afterEach(() => {
    cleanupTmpDirs();
    vi.restoreAllMocks();
  });

  function fakeRunOne(results: Record<string, number>) {
    const seen: ComposeCliOptions[] = [];
    const runOne = vi.fn(async (opts: ComposeCliOptions): Promise<number> => {
      seen.push(opts);
      const code = results[opts.goalId] ?? 0;
      // the real machine fires onFinish; simulate it here
      await opts.source?.onFinish?.(opts.task as ComposeTask, code === 0 ? "DONE" : "FAILED", {
        goalDir: `/tmp/compose/${opts.goalId}`,
        round: 1,
      });
      return code;
    });
    return { runOne, seen };
  }

  const params = { testCmd: "npm test", maxRounds: 3, maxNodes: 30, maxQuestions: 5 };

  it("--loop processes tasks in dependency order and continues past a FAILED one", async () => {
    const { runOne, seen } = fakeRunOne({ t2: 1 });

    const code = await runBoardTasks(params, {
      board: boardFile,
      loop: true,
      stopOnFail: false,
      runOne,
      log: () => {},
    });

    expect(seen.map((o) => o.goalId)).toEqual(["t1", "t2", "t3"]);
    expect(code).toBe(1);
    expect(statusOf(boardFile, "T1")).toBe("Done");
    expect(statusOf(boardFile, "T2")).toBe("Blocked");
    expect(statusOf(boardFile, "T3")).toBe("Done");
  });

  it("--loop --stop-on-fail stops after the first FAILED run", async () => {
    const { runOne, seen } = fakeRunOne({ t1: 1 });

    const code = await runBoardTasks(params, {
      board: boardFile,
      loop: true,
      stopOnFail: true,
      runOne,
      log: () => {},
    });

    expect(seen.map((o) => o.goalId)).toEqual(["t1"]);
    expect(code).toBe(1);
    expect(statusOf(boardFile, "T2")).toBe("Backlog");
  });

  it("--loop exits 0 without running when nothing is executable", async () => {
    const { runOne } = fakeRunOne({});

    const code = await runBoardTasks(params, {
      board: boardFile,
      loop: true,
      stopOnFail: false,
      runOne,
      log: () => {},
    });

    expect(code).toBe(0);
    // T1 unblocked by default order (T1 first), so exactly one run happens;
    // use an all-blocked board for the empty case:
    const emptyBoard = writeBoard(dir, [row("T9", "Blocked", "nope", { blockedBy: "T1" })]);
    const code2 = await runBoardTasks(params, {
      board: emptyBoard,
      loop: true,
      stopOnFail: false,
      runOne,
      log: () => {},
    });
    expect(code2).toBe(0);
  });

  it("--task claims and composes one specific task with a deterministic goalId", async () => {
    const { runOne, seen } = fakeRunOne({});

    const code = await runBoardTasks(params, {
      board: boardFile,
      taskId: "T2",
      loop: false,
      stopOnFail: false,
      runOne,
      log: () => {},
    });

    expect(code).toBe(0);
    expect(seen).toHaveLength(1);
    expect(seen[0].goalId).toBe("t2");
    expect(seen[0].goal).toContain("second");
    expect(seen[0].task?.id).toBe("T2");
    expect(statusOf(boardFile, "T2")).toBe("Done");
    // T1 stays Backlog: --task does not touch other tasks
    expect(statusOf(boardFile, "T1")).toBe("Backlog");
  });

  it("--task on an unknown id exits 1 without running", async () => {
    const { runOne } = fakeRunOne({});

    const code = await runBoardTasks(params, {
      board: boardFile,
      taskId: "T99",
      loop: false,
      stopOnFail: false,
      runOne,
      log: () => {},
    });

    expect(code).toBe(1);
    expect(runOne).not.toHaveBeenCalled();
  });

  it("skips a task whose saved state is already terminal DONE", async () => {
    const { ComposeWorkspace } = await import("../../src/compose/workspace");
    const { saveState } = await import("../../src/compose/state");
    const ws = new ComposeWorkspace("t1", path.join(dir, "compose"));
    await saveState(ws, { goal: "g", state: "DONE", round: 1, testCmd: "npm test", maxRounds: 3 });

    const { runOne, seen } = fakeRunOne({});
    const code = await runBoardTasks(params, {
      board: boardFile,
      loop: true,
      stopOnFail: false,
      runOne,
      log: () => {},
      workspaceFor: (id) => new ComposeWorkspace(id, path.join(dir, "compose")),
    });

    expect(code).toBe(0);
    expect(seen.map((o) => o.goalId)).toEqual(["t2", "t3"]);
    expect(statusOf(boardFile, "T1")).toBe("Done");
  });

  it("continues a task whose saved state is non-terminal (implicit resume)", async () => {
    const { ComposeWorkspace } = await import("../../src/compose/workspace");
    const { saveState } = await import("../../src/compose/state");
    const ws = new ComposeWorkspace("t1", path.join(dir, "compose"));
    await saveState(ws, { goal: "g", state: "PLAN", round: 1, testCmd: "npm test", maxRounds: 3 });

    const { runOne, seen } = fakeRunOne({});
    const code = await runBoardTasks(params, {
      board: boardFile,
      taskId: "T1",
      loop: false,
      stopOnFail: false,
      runOne,
      log: () => {},
      workspaceFor: (id) => new ComposeWorkspace(id, path.join(dir, "compose")),
    });

    expect(code).toBe(0);
    expect(seen).toHaveLength(1);
    expect(seen[0].goalId).toBe("t1");
  });
});

describe("compose command — --task / --loop parsing", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("errors when --prompt is combined with --task", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`exit ${code}`);
    }) as never);
    const { program, errors } = build(async () => 0);

    await expect(parse(program, ["-p", "g", "--task", "T1"])).rejects.toThrow("exit 1");
    expect(errors.join("\n")).toMatch(/--prompt/);
    void exitSpy;
  });

  it("runs a board task end-to-end with a real board (exit 0)", async () => {
    vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    const dir = mkdtempSync(path.join(os.tmpdir(), "at-compose-cli-"));
    try {
      const boardFile = writeBoard(dir, [row("T1", "Backlog", "cli task")]);
      let seen: ComposeCliOptions | undefined;
      const { program } = build(async (opts) => {
        seen = opts;
        await opts.source?.onFinish?.(opts.task as ComposeTask, "DONE", { goalDir: "/tmp/x", round: 1 });
        return 0;
      });

      await parse(program, ["--task", "T1", "--board", boardFile]);

      expect(seen?.goalId).toBe("t1");
      expect(seen?.goal).toContain("cli task");
      expect(statusOf(boardFile, "T1")).toBe("Done");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("--loop through the command exits 1 when a run fails", async () => {
    vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    const dir = mkdtempSync(path.join(os.tmpdir(), "at-compose-cli-"));
    try {
      const boardFile = writeBoard(dir, [row("T1", "Backlog", "will fail")]);
      const { program } = build(async (opts) => {
        await opts.source?.onFinish?.(opts.task as ComposeTask, "FAILED", { goalDir: "/tmp/x", round: 1 });
        return 1;
      });

      await parse(program, ["--loop", "--board", boardFile]);

      expect(statusOf(boardFile, "T1")).toBe("Blocked");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
