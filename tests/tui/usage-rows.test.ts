import { describe, expect, it } from "vitest";
import type { RunRecord } from "../../src/run-store";
import { usageLines } from "../../src/tui/components/Dashboard";
import { budgetColor, runMetaRows, usageRows } from "../../src/tui/components/RunMeta";
import type { TaskBudget } from "../../src/usage/summary";
import { summarizeUsage } from "../../src/usage/summary";

const run = (over: Partial<RunRecord> = {}): RunRecord => ({
  runId: "r1",
  agent: "qwen",
  tier: 2,
  pid: 1,
  prompt: "p",
  logFile: "/tmp/x.log",
  startedAt: "2026-10-15T10:00:00.000Z",
  finishedAt: "2026-10-15T10:12:00.000Z",
  exitCode: 0,
  status: "done",
  name: "n",
  ...over,
});

const budget: TaskBudget = {
  taskId: "T9",
  title: "t",
  status: "Done",
  estMs: 600_000,
  actualMs: 720_000,
  runs: 1,
  timeState: "near",
};

describe("TUI usage rows", () => {
  it("no rows while nothing is metered (legacy runs keep the 4-row layout)", () => {
    expect(usageRows(run(), null)).toEqual([]);
    expect(runMetaRows(run())).toHaveLength(4);
  });

  it("shows run time plus task budget lines with state colours", () => {
    const rows = usageRows(run(), budget);
    const fields = rows.flatMap((r) => (r.kind === "fields" ? r.fields : []));
    expect(fields.map((f) => f.label)).toEqual(["time", "T9 time"]);
    expect(fields[1].color).toBe(budgetColor("near"));
    expect(budgetColor("none")).toBeUndefined();
  });

  it("dashboard usage lines", () => {
    const s = summarizeUsage([run()], [budget]);
    const [a, b] = usageLines(s);
    expect(a).toBe("time 12m · 1 finished runs");
    expect(b).toBe("tasks 1 metered · over budget 0 · time 120% of plan");
    expect(usageLines(summarizeUsage([], []))[1]).toBe("tasks: none metered yet");
  });
});
