import { describe, expect, it } from "vitest";
import type { RunRecord } from "../../src/run-store";
import { buildTaskBudgets, runUsageLines, summarizeUsage } from "../../src/usage/summary";
import type { TaskTotals } from "../../src/usage/task-metrics";

const tasks = [
  { ID: "T1", Status: "Done", Title: "a", "Est Time": "10m", "Est Tokens": "100k" },
  { ID: "T2", Status: "Done", Title: "b", "Est Time": "10m", "Est Tokens": "-" },
  { ID: "T3", Status: "Backlog", Title: "c", "Est Time": "1h", "Est Tokens": "50k" },
  { ID: "T4", Status: "Done", Title: "d" },
];
const tot = (taskId: string, ms: number, tokens: number, runs = 1, estimated = false): [string, TaskTotals] => [
  taskId,
  { taskId, runs, ms, tokensIn: tokens, tokensOut: 0, tokens, estimated },
];

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
  const totals = new Map([tot("T1", 5 * 60_000, 150_000, 2), tot("T2", 9 * 60_000, 1000), tot("T4", 1000, 1)]);
  const b = buildTaskBudgets(tasks, totals);
  it("states", () => {
    expect(b[0]).toMatchObject({ estMs: 600_000, estTokens: 100_000, timeState: "under", tokenState: "over", runs: 2 });
    expect(b[1]).toMatchObject({ timeState: "under", tokenState: "none", estTokens: null });
    expect(b[2]).toMatchObject({ runs: 0, timeState: "none", tokenState: "none" });
    expect(b[3]).toMatchObject({ estMs: null, timeState: "none" });
  });
  it("summarizeUsage", () => {
    const s = summarizeUsage(
      [
        run({ usage: { tokensIn: 100, tokensOut: 50, source: "reported" } }),
        run({ usage: { tokensIn: 10, tokensOut: 5, source: "estimated" } }),
        run({ status: "running", finishedAt: null }),
      ],
      b,
    );
    expect(s).toMatchObject({ runs: 2, ms: 24 * 60_000, tokens: 165, estimatedRuns: 1 });
    expect(s).toMatchObject({ tasksMetered: 3, tasksWithEstimate: 2, tasksOverBudget: 1 });
    expect(s.timeRatio).toBeCloseTo(14 / 20);
    expect(s.tokenRatio).toBeCloseTo(1.5);
  });
  it("runUsageLines", () => {
    const lines = runUsageLines(run({ usage: { tokensIn: 1200, tokensOut: 300, source: "estimated" } }), b[0]);
    expect(lines.map((l) => l.label)).toEqual(["time", "tokens", "T1 time", "T1 tokens"]);
    expect(lines[1].value).toBe("1.2k in · 300 out (est)");
    expect(lines[2]).toMatchObject({ value: "5m / est 10m (-50%) · 2 runs", state: "under" });
    expect(lines[3]).toMatchObject({ value: "150k / est 100k (+50%)", state: "over" });
    expect(runUsageLines(run(), null).map((l) => l.label)).toEqual(["time"]);
  });
});
