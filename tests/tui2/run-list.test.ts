import { describe, expect, it } from "vitest";
import { type RunRecord, UNNAMED_PLACEHOLDER } from "../../src/run-store";
import { computeStats } from "../../src/tui2/components/Dashboard";
import { clampRow, SETTING_ACTIONS, SETTINGS_ROW_COUNT } from "../../src/tui2/components/Settings";
import { groupRunsByDate, runLabel } from "../../src/tui2/components/Sidebar";
import {
  dateBucket,
  durationMs,
  formatAgentRow,
  formatClock,
  formatDuration,
  formatMs,
  formatRunRow,
  isToday,
  lineColor,
  RUN_COL,
  statusColor,
  statusIcon,
  TUI2_COLORS,
  truncate,
} from "../../src/tui2/format";

const NOW = new Date();

/** A timestamp pinned to today's calendar date, so day buckets never depend on run time. */
const at = (hour: number, minute = 0): string =>
  new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate(), hour, minute, 0).toISOString();

const YEARS_AGO = new Date(NOW.getTime() - 400 * 24 * 60 * 60 * 1000).toISOString();

const mockRun = (runId: string, overrides: Partial<RunRecord> = {}): RunRecord => ({
  runId,
  agent: "mm-code",
  tier: 2,
  pid: 1234,
  prompt: "do the thing",
  logFile: `/tmp/${runId}.log`,
  startedAt: at(11),
  finishedAt: null,
  exitCode: null,
  status: "running",
  name: UNNAMED_PLACEHOLDER,
  ...overrides,
});

describe("tui2 sidebar grouping", () => {
  it("buckets runs by day and keeps their order", () => {
    const groups = groupRunsByDate([
      mockRun("r1", { startedAt: at(10) }),
      mockRun("r2", { startedAt: at(11) }),
      mockRun("r3", { startedAt: YEARS_AGO }),
    ]);

    expect(groups.map((g) => g.runs.map((r) => r.runId))).toEqual([["r1", "r2"], ["r3"]]);
    expect(groups[0].label).toBe("Today");
    expect(groups[1].label).toBe(dateBucket(YEARS_AGO));
  });

  it("returns nothing for an empty list", () => {
    expect(groupRunsByDate([])).toEqual([]);
  });

  it("labels a run by its namer output once named, run id otherwise", () => {
    expect(runLabel(mockRun("r1"))).toBe("r1");
    expect(runLabel(mockRun("r1", { name: "Fix kanban lint" }))).toBe("Fix kanban lint");
  });
});

describe("tui2 dashboard stats", () => {
  const runs = [
    mockRun("r1"),
    mockRun("r2", { status: "done", exitCode: 0, startedAt: at(10), finishedAt: at(11) }),
    mockRun("r3", { status: "failed", exitCode: 1, startedAt: at(9, 30), finishedAt: at(10) }),
    mockRun("r4", { status: "stuck", startedAt: YEARS_AGO }),
  ];

  it("splits active from finished runs", () => {
    const stats = computeStats(runs);
    expect(stats.total).toBe(4);
    expect(stats.running.map((r) => r.runId)).toEqual(["r1"]);
    expect(stats.completed.map((r) => r.runId)).toEqual(["r2", "r3", "r4"]);
    expect(stats.stuck).toBe(1);
  });

  it("counts only runs started today", () => {
    expect(computeStats(runs).today).toBe(3);
  });

  it("rates success over runs that reported an exit code", () => {
    // r4 is stuck with no exit code, so only r2/r3 count.
    expect(computeStats(runs).successRate).toBe(50);
    expect(computeStats([mockRun("only", { status: "running" })]).successRate).toBeNull();
  });

  it("averages run length over finished runs", () => {
    expect(computeStats(runs).avgDurationMs).toBe((3_600_000 + 1_800_000) / 2);
  });

  it("survives an empty run list", () => {
    expect(computeStats([])).toMatchObject({ total: 0, successRate: null, avgDurationMs: 0, today: 0 });
  });
});

describe("tui2 settings rows", () => {
  it("exposes the five preferences the view edits", () => {
    expect(SETTING_ACTIONS.map((row) => row.label)).toEqual([
      "Default tier",
      "Default agent",
      "Run mode",
      "Retries",
      "Auto-refresh",
    ]);
    expect(SETTINGS_ROW_COUNT).toBe(5);
  });

  it("reads each current value as text", () => {
    for (const row of SETTING_ACTIONS) {
      expect(typeof row.value()).toBe("string");
      expect(typeof row.act).toBe("function");
    }
  });

  it("clamps the cursor into range", () => {
    expect(clampRow(-5)).toBe(0);
    expect(clampRow(2)).toBe(2);
    expect(clampRow(99)).toBe(SETTINGS_ROW_COUNT - 1);
  });
});

describe("tui2 format helpers", () => {
  it("formats durations from start/finish", () => {
    const started = new Date("2026-03-01T10:00:00.000Z");
    const r = mockRun("r", {
      startedAt: started.toISOString(),
      finishedAt: new Date(started.getTime() + 65_000).toISOString(),
    });
    expect(durationMs(r)).toBe(65_000);
    expect(formatDuration(r)).toBe("1m 05s");
    expect(formatMs(500)).toBe("500ms");
    expect(formatMs(45_000)).toBe("45s");
    expect(formatMs(65_000)).toBe("1m 05s");
    expect(formatMs(3_720_000)).toBe("1h 02m");
  });

  it("counts a running span up to now", () => {
    const r = mockRun("r", { startedAt: new Date(Date.now() - 5_000).toISOString(), finishedAt: null });
    expect(durationMs(r)).toBeGreaterThanOrEqual(5_000);
    expect(durationMs(r)).toBeLessThan(60_000);
  });

  it("buckets dates", () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    expect(dateBucket(at(11))).toBe("Today");
    expect(dateBucket(yesterday.toISOString())).toBe("Yesterday");
    expect(dateBucket("2026-01-05T12:00:00.000Z")).toBe("5 Jan");
  });

  it("flags today for dashboard counters", () => {
    expect(isToday(at(0))).toBe(true);
    expect(isToday(at(23, 59))).toBe(true);
    expect(isToday(YEARS_AGO)).toBe(false);
  });

  it("prints a dash for a missing timestamp", () => {
    expect(formatClock(null)).toBe("-");
    expect(formatClock(NOW.toISOString())).toBe(NOW.toLocaleTimeString());
  });

  it("truncates with an ellipsis", () => {
    expect(truncate("abcdef", 6)).toBe("abcdef");
    expect(truncate("abcdef", 4)).toBe("abc…");
  });

  it("maps status to icon and colour", () => {
    expect(statusIcon("running")).toBe("●");
    expect(statusIcon("done")).toBe("✓");
    expect(statusIcon("failed")).toBe("✗");
    expect(statusIcon("stuck")).toBe("⚠");
    expect(statusColor("failed")).toBe("#f85149");
  });

  it("tints log lines", () => {
    expect(lineColor("[ERROR] boom")).toBe("#f85149");
    expect(lineColor("[WARN] careful")).toBe("#d29922");
    expect(lineColor("✓ done")).toBe("#3fb950");
    expect(lineColor("plain output")).toBe("#c9d1d9");
  });

  it("exposes shared tui2 palette and column widths", () => {
    expect(TUI2_COLORS.accent).toBe("#58a6ff");
    expect(TUI2_COLORS.error).toBe("#f85149");
    expect(RUN_COL).toEqual({ ID: 20, AGENT: 12, STATUS: 8 });
  });

  it("formats a running row with status and no exit code", () => {
    const r = mockRun("alpha-111", { agent: "mm-code", status: "running" });
    const row = formatRunRow(r, { status: true });
    expect(row.startsWith("●  alpha-111")).toBe(true);
    expect(row).toContain("mm-code".padEnd(12));
    expect(row).toContain("running");
    // No exit-code column means the row is exactly: icon + id + agent + status + duration.
    expect(row).not.toMatch(/code -|code \d/);
    expect(row).toBe(
      ["●", "alpha-111".padEnd(20), "mm-code".padEnd(12), "running".padEnd(8), formatMs(durationMs(r))].join("  "),
    );
  });

  it("formats a completed row with status + exit code + duration", () => {
    const started = new Date("2026-03-01T10:00:00.000Z");
    const r = mockRun("beta-222", {
      agent: "opencode",
      status: "failed",
      exitCode: 1,
      startedAt: started.toISOString(),
      finishedAt: new Date(started.getTime() + 65_000).toISOString(),
    });
    const row = formatRunRow(r, { status: true, exitCode: true });
    expect(row).toContain("✗  beta-222");
    expect(row).toContain("opencode  ");
    expect(row).toContain("failed");
    expect(row).toContain("code 1");
    expect(row.endsWith("1m 05s")).toBe(true);
  });

  it("formats a healthy vs disabled agent row", () => {
    const healthy = formatAgentRow({ name: "mm-code", failures: 0, deactivated: false });
    expect(healthy.startsWith("✓ mm-code   ")).toBe(true);
    expect(healthy).toContain("failures 0");
    expect(healthy).not.toContain("disabled");

    const down = formatAgentRow({ name: "opencode", failures: 3, deactivated: true });
    expect(down.startsWith("✗ opencode")).toBe(true);
    expect(down).toContain("failures 3");
    expect(down).toContain("(disabled)");
  });
});
