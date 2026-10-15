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
  tokensIn: 150_000,
  tokensOut: 50_000,
  tokens: 200_000,
  estimatedRuns: 1,
  tasksMetered: 2,
  tasksWithEstimate: 2,
  tasksOverBudget: 1,
  timeRatio: 0.8,
  tokenRatio: 1.5,
};
const budget: ApiUsage["budgets"][number] = {
  taskId: "T9",
  title: "slow one",
  status: "Done",
  estMs: 600_000,
  estTokens: 100_000,
  actualMs: 1_200_000,
  actualTokens: 150_000,
  runs: 2,
  estimated: false,
  timeState: "over",
  tokenState: "over",
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
  usage: { tokensIn: 2000, tokensOut: 500, source: "reported" },
  taskId: "T9",
};

beforeEach(() => usage.set(null));

describe("usage tiles", () => {
  it("derives consumed + health tiles", () => {
    const t = deriveUsageTiles(summary);
    expect(t.map((x) => [x.label, x.value])).toEqual([
      ["Time consumed", "1h00m"],
      ["Tokens consumed", "200k"],
      ["Time vs plan", "80%"],
      ["Tokens vs plan", "150%"],
      ["Over budget", "1"],
    ]);
    expect(t[2].tone).toBe("under");
    expect(t[3].tone).toBe("over");
    expect(t[4].tone).toBe("over");
  });
});

describe("UsagePanel", () => {
  it("empty state, then tiles and over-budget list", async () => {
    render(UsagePanel);
    expect(screen.getByTestId("usage-empty")).toBeTruthy();
    usage.set({ summary, budgets: [budget] });
    expect(await screen.findAllByTestId("usage-tile")).toHaveLength(5);
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
      expect.stringContaining("2k in · 500 out"),
      expect.stringContaining("T9 time"),
      expect.stringContaining("T9 tokens"),
    ]);
  });

  it("no usage rows for legacy runs", () => {
    render(RunMeta, { run: { ...run, usage: undefined, taskId: undefined } });
    expect(screen.queryAllByTestId("run-usage-row")).toHaveLength(0);
  });
});
