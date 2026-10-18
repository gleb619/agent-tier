import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parsePlanTime } from "../../src/kanban/plan-time";
import { calibrationFactor, estimateMs, toDurationText } from "../../src/usage/estimate";
import { estimateTasks } from "../../src/usage/summary";
import { recordTaskMetric } from "../../src/usage/task-metrics";
import { parseDuration } from "../../src/usage/units";

describe("calibration", () => {
  it("is 1 without enough history", () => {
    expect(calibrationFactor([{ plannedMs: 10, actualMs: 30 }])).toBe(1);
  });
  it("uses the median actual/planned, clamped", () => {
    const s = (p: number, a: number) => ({ plannedMs: p, actualMs: a });
    expect(calibrationFactor([s(10, 20), s(10, 15), s(10, 40)])).toBeCloseTo(2);
    expect(calibrationFactor([s(1, 100), s(1, 100), s(1, 100)])).toBe(4);
  });
  it("estimateMs / toDurationText roundtrip through parseDuration", () => {
    expect(estimateMs(600_000, 1.5)).toBe(900_000);
    for (const ms of [45_000, 45 * 60_000, 90 * 60_000, 26 * 3_600_000]) {
      expect(parseDuration(toDurationText(ms))).toBe(ms);
    }
  });
});

describe("estimateTasks", () => {
  it("writes Estimated = Planned × factor into the plan, leaving Planned alone", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "at-est-"));
    mkdirSync(path.join(dir, "docs", "plans"), { recursive: true });
    const plan = (id: string, planned: string) => {
      writeFileSync(path.join(dir, "docs", "plans", `${id}.md`), `# ${id}\n\n## Time\n\nPlanned: ${planned}\n`);
    };
    for (const id of ["T1", "T2", "T3", "T4"]) plan(id, "10m");
    const board = path.join(dir, "docs", "kanban.md");
    writeFileSync(
      board,
      [
        "## Status Legend",
        "",
        "| Status | M | W |",
        "| :-- | :-- | :-- |",
        "| `Backlog` | a | b |",
        "| `Done` | a | b |",
        "",
        "| ID | Status | Title | Plan File |",
        "| :-- | :-- | :-- | :-- |",
        "| T1 | Done | a | plans/T1.md |",
        "| T2 | Done | b | plans/T2.md |",
        "| T3 | Done | c | plans/T3.md |",
        "| T4 | Backlog | d | plans/T4.md |",
        "",
      ].join("\n"),
    );
    for (const id of ["T1", "T2", "T3"]) {
      await recordTaskMetric(dir, { taskId: id, runId: `r-${id}`, agent: "a", ms: 20 * 60_000, ts: "t" });
    }

    const res = estimateTasks([dir], board);
    expect(res).toHaveLength(1);
    expect(res[0]).toMatchObject({ taskId: "T4", factor: 2, outcome: "written" });
    const t = parsePlanTime(readFileSync(path.join(dir, "docs", "plans", "T4.md"), "utf8"));
    expect(t).toEqual({ hasSection: true, planned: "10m", estimated: "20m" });
    expect(estimateTasks([dir], board)[0].outcome).toBe("unchanged");
  });
});
