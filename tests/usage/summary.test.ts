import { describe, expect, it } from "vitest";
import type { RunRecord } from "../../src/run-store";
import { buildTaskBudgets, runUsageLines, summarizeUsage } from "../../src/usage/summary";
import type { TaskTotals } from "../../src/usage/task-metrics";

const tasks = [
  { ID: "T1", Status: "Done", Title: "a" },
  { ID: "T2", Status: "Done", Title: "b" },
  { ID: "T3", Status: "Backlog", Title: "c" },
  { ID: "T4", Status: "Done", Title: "d" },
];
const tot = (taskId: string, ms: number, runs = 1): [string, TaskTotals] => [taskId, { taskId, runs, ms }];

function run(over: Partial<RunRecord> = {}): RunRecord {
  return {
    runId: "r",
    agent: "qwen",
    tier: 2,
    pid: 1,
    prompt: "",
    logFile: "",
    startedAt: "2026-10-15T10:00:00.000Z",
    finishedAt: "2026-10-15T10:12:00.000Z",
    exitCode: 0,
    status: "done",
    name: "n",
    ...over,
  };
}

describe("buildTaskBudgets", () => {
  const totals = new Map([tot("T1", 5 * 60_000, 2), tot("T2", 13 * 60_000), tot("T4", 1000)]);
  const times = new Map([
    ["T1", { plannedMs: 600_000, estMs: 660_000 }],
    ["T2", { plannedMs: 600_000, estMs: null }],
    ["T3", { plannedMs: 3_600_000, estMs: null }],
  ]);
  const b = buildTaskBudgets(tasks, totals, times);
  it("states", () => {
    expect(b[0]).toMatchObject({ plannedMs: 600_000, estMs: 660_000, timeState: "under", runs: 2 });
    expect(b[1]).toMatchObject({ timeState: "over" });
    expect(b[2]).toMatchObject({ runs: 0, timeState: "none" });
    expect(b[3]).toMatchObject({ plannedMs: null, estMs: null, timeState: "none" });
  });
  it("summarizeUsage", () => {
    const s = summarizeUsage([run(), run(), run({ status: "running", finishedAt: null })], b);
    expect(s).toMatchObject({ runs: 2, ms: 24 * 60_000 });
    expect(s).toMatchObject({ tasksMetered: 3, tasksWithEstimate: 2, tasksOverBudget: 1 });
    expect(s.timeRatio).toBeCloseTo(18 / 20);
  });
  it("runUsageLines", () => {
    const lines = runUsageLines(run(), b[0]);
    expect(lines.map((l) => l.label)).toEqual(["time", "T1 time"]);
    expect(lines[1]).toMatchObject({ value: "5m / planned 10m (-50%) · est 11m · 2 runs", state: "under" });
    expect(runUsageLines(run(), null).map((l) => l.label)).toEqual(["time"]);
  });
});
