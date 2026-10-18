import { render, screen } from "@testing-library/svelte";
import { beforeEach, describe, expect, it } from "vitest";
import UsagePanel from "../components/dashboard/UsagePanel.svelte";
import RunMeta from "../components/run/RunMeta.svelte";
import { usage } from "../stores/usage";
import type { ApiRun, ApiUsage } from "../types/api";
import { deriveUsageTiles } from "../utils/usage";

const summary: ApiUsage["summary"] = {
  runs: 3,
  ms: 3_600_000,
  tasksMetered: 2,
  tasksWithEstimate: 2,
  tasksOverBudget: 1,
  timeRatio: 0.8,
};
const budget: ApiUsage["budgets"][number] = {
  taskId: "T9",
  title: "slow one",
  status: "Done",
  plannedMs: 600_000,
  estMs: 660_000,
  actualMs: 1_200_000,
  runs: 2,
  timeState: "over",
};

const run: ApiRun = {
  runId: "r1",
  agent: "qwen",
  tier: 2,
  pid: 1,
  prompt: "p",
  logFile: "/tmp/r1.log",
  startedAt: "2026-10-15T10:00:00.000Z",
  finishedAt: "2026-10-15T10:12:00.000Z",
  exitCode: 0,
  status: "done",
  name: "Run r1",
  taskId: "T9",
};

beforeEach(() => usage.set(null));

describe("usage tiles", () => {
  it("derives consumed + health tiles", () => {
    const t = deriveUsageTiles(summary);
    expect(t.map((x) => [x.label, x.value])).toEqual([
      ["Time consumed", "1h00m"],
      ["Time vs plan", "80%"],
      ["Over budget", "1"],
    ]);
    expect(t[1].tone).toBe("under");
    expect(t[2].tone).toBe("over");
  });
});

describe("UsagePanel", () => {
  it("empty state, then tiles and over-budget list", async () => {
    render(UsagePanel);
    expect(screen.getByTestId("usage-empty")).toBeTruthy();
    usage.set({ summary, budgets: [budget] });
    expect(await screen.findAllByTestId("usage-tile")).toHaveLength(3);
    expect(screen.getByTestId("usage-over-budget").textContent).toContain("T9");
  });
});

describe("RunMeta usage rows", () => {
  it("shows run + task budget rows when metered", async () => {
    usage.set({ summary, budgets: [budget] });
    render(RunMeta, { run });
    const rows = await screen.findAllByTestId("run-usage-row");
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining("12m"),
      expect.stringContaining("T9 time"),
    ]);
  });

  it("no usage rows for legacy runs", () => {
    render(RunMeta, { run: { ...run, taskId: undefined } });
    expect(screen.queryAllByTestId("run-usage-row")).toHaveLength(0);
  });
});
