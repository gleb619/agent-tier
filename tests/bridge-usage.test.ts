import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { dispatchBridge } from "../src/bridge";
import { addRun, updateRun } from "../src/run-store";
import { recordRunForTask } from "../src/usage/task-metrics";

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop() as string, { recursive: true, force: true });
});

describe("bridge usage summary", () => {
  it("joins runs, task metrics and kanban estimates", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "at-bu-"));
    dirs.push(dir);
    const logFile = path.join(dir, "r1.log");
    writeFileSync(logFile, '{"usage":{"inputTokens":150000,"outputTokens":50000}}\n');
    await addRun(dir, {
      runId: "r1",
      agent: "qwen",
      tier: 2,
      pid: 1,
      prompt: "p",
      logFile,
      startedAt: "2026-10-15T10:00:00.000Z",
      finishedAt: null,
      exitCode: null,
      status: "running",
      name: "n",
    });
    await updateRun(dir, "r1", { status: "done", exitCode: 0, finishedAt: "2026-10-15T10:20:00.000Z" });
    await recordRunForTask(dir, "r1", "T1");

    const board = path.join(dir, "kanban.md");
    writeFileSync(
      board,
      [
        "## Status Legend",
        "",
        "| Status | Meaning | Who |",
        "| :-- | :-- | :-- |",
        "| `Done` | d | a |",
        "",
        "| ID | Status | Title | Est Time | Est Tokens |",
        "| :-- | :-- | :-- | :-- | :-- |",
        "| T1 | Done | first | 10m | 100k |",
        "",
      ].join("\n"),
    );

    const out = (await dispatchBridge("usage", "summary", { board }, { stateDirs: [dir] })) as {
      summary: { runs: number; tokens: number; tasksOverBudget: number };
      budgets: Array<{ taskId: string; actualMs: number; timeState: string; tokenState: string }>;
    };
    expect(out.summary).toMatchObject({ runs: 1, tokens: 200_000, tasksOverBudget: 1 });
    expect(out.budgets).toHaveLength(1);
    expect(out.budgets[0]).toMatchObject({
      taskId: "T1",
      actualMs: 20 * 60_000,
      timeState: "over",
      tokenState: "over",
    });
  });

  it("no board / no metrics → empty budgets, never throws", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "at-bu-"));
    dirs.push(dir);
    const out = (await dispatchBridge(
      "usage",
      "summary",
      { board: path.join(dir, "none.md") },
      { stateDirs: [dir] },
    )) as {
      budgets: unknown[];
    };
    expect(out.budgets).toEqual([]);
  });
});
