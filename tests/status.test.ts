import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as configModule from "../src/config";
import type { RunRecord } from "../src/run-store";
import { buildStateReport, formatStateReport, formatStatusJson, formatStatusTable } from "../src/status";

const baseRun: RunRecord = {
  runId: "r3k2a1b9",
  agent: "opencode",
  tier: 2,
  pid: 28451,
  prompt: "fix the bug",
  logFile: "/tmp/at-logs/at-test-opencode.log",
  startedAt: new Date().toISOString(),
  finishedAt: null,
  exitCode: null,
  status: "running",
  name: "unnamed",
};

describe("formatStatusTable", () => {
  it('shows "no runs found" for empty array', () => {
    expect(formatStatusTable([])).toContain("no runs found");
  });

  it("formats a table with header and rows", () => {
    const result = formatStatusTable([baseRun]);
    const lines = result.split("\n");
    expect(lines[0]).toBe("# Runs");
    expect(lines[2]).toContain("RUN");
    expect(lines[2]).toContain("NAME");
    expect(lines[2]).toContain("AGENT");
    expect(lines[2]).toContain("STATUS");
    expect(lines[2]).toContain("DURATION");
    expect(lines[2]).toContain("LOG");
    expect(lines[3]).toContain("---");
    expect(lines[4]).toContain("r3k2a1");
    expect(lines[4]).toContain("unnamed");
    expect(lines[4]).toContain("opencode");
    expect(lines[4]).toContain("running");
    expect(lines[4]).toContain("/tmp/at-logs/at-test-opencode.log");
  });

  it('shows full runId without "..." truncation in table', () => {
    const longRunId = "r3k2a1b9-static-long-id-for-test";
    const run = { ...baseRun, runId: longRunId };
    const result = formatStatusTable([run]);
    expect(result).toContain(longRunId);
    expect(result).not.toContain(`${longRunId.slice(0, 17)}...`);
  });

  it("formats multiple runs", () => {
    const done: RunRecord = {
      ...baseRun,
      runId: "f7c4d2e1",
      agent: "mm-code",
      status: "done",
      exitCode: 0,
      finishedAt: new Date().toISOString(),
    };
    const result = formatStatusTable([baseRun, done]);
    const lines = result.split("\n");
    expect(lines[4]).toContain("running");
    expect(lines[5]).toContain("done");
  });

  it("truncates long names with ellipsis", () => {
    const longName = "a".repeat(40);
    const run: RunRecord = { ...baseRun, name: longName };
    const result = formatStatusTable([run]);
    expect(result).toContain("…");
    expect(result).not.toContain(longName);
  });

  it("keeps short names untruncated", () => {
    const run: RunRecord = { ...baseRun, name: "refactor-auth" };
    const result = formatStatusTable([run]);
    expect(result).toContain("refactor-auth");
  });
});

describe("formatStatusJson", () => {
  it("returns valid JSON", () => {
    const result = formatStatusJson([baseRun]);
    expect(() => JSON.parse(result)).not.toThrow();
  });

  it("total matches runs.length", () => {
    const result = JSON.parse(formatStatusJson([baseRun, { ...baseRun, runId: "x", status: "done" }]));
    expect(result.total).toBe(2);
    expect(result.runs).toHaveLength(2);
  });

  it("runId not truncated", () => {
    const longRunId = "r3k2a1b9-static-long-id-for-test";
    const run = { ...baseRun, runId: longRunId };
    const result = JSON.parse(formatStatusJson([run]));
    expect(result.runs[0].runId).toBe(longRunId);
  });

  it("agent not truncated", () => {
    const result = JSON.parse(formatStatusJson([baseRun]));
    expect(result.runs[0].agent).toBe("opencode");
  });

  it("logFile not truncated", () => {
    const result = JSON.parse(formatStatusJson([baseRun]));
    expect(result.runs[0].logFile).toBe("/tmp/at-logs/at-test-opencode.log");
  });

  it("includes state when provided, omits it otherwise (text/JSON parity)", () => {
    const state = { scheduler: [], maxEntries: null, agents: [] };
    const withState = JSON.parse(formatStatusJson([baseRun], state));
    expect(withState.state).toEqual(state);
    expect(withState.total).toBe(1);
    const withoutState = JSON.parse(formatStatusJson([baseRun]));
    expect("state" in withoutState).toBe(false);
  });

  it("round-trips null-typed optional fields losslessly", () => {
    const state = {
      scheduler: [{ key: "tier-2", index: 99, agentName: null }],
      maxEntries: null,
      agents: [{ name: "qwen", deactivated: false, failures: 0, lastFailure: null, disabledTo: null }],
    };
    const parsed = JSON.parse(formatStatusJson([baseRun], state));
    expect(parsed.state).toEqual(state);
    expect("agentName" in parsed.state.scheduler[0]).toBe(true);
    expect("lastFailure" in parsed.state.agents[0]).toBe(true);
    expect("disabledTo" in parsed.state.agents[0]).toBe(true);
    expect("maxEntries" in parsed.state).toBe(true);
  });
});

// --- State report with agent health ---

const tmpDir = path.join(os.tmpdir(), `at-status-test-${process.pid}`);

function writeTestStateFile(agentlyHealth: Record<string, unknown>, scheduler?: Record<string, { index: number }>) {
  mkdirSync(tmpDir, { recursive: true });
  const state = {
    agents: agentlyHealth,
    scheduler: scheduler ?? { default: { index: 1 } },
    runs: { maxEntries: 50 },
  };
  writeFileSync(path.join(tmpDir, "state.json"), JSON.stringify(state, null, 2));
}

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

afterEach(() => {
  vi.restoreAllMocks();
});

// buildStateReport resolves `line` scheduler keys via loadConfig().
// Mock it so tests don't depend on the developer's real ~/.at/config.json.
function mockLineConfig(line: string[]): void {
  vi.spyOn(configModule, "loadConfig").mockReturnValue({ line });
}

describe("buildStateReport", () => {
  it("does not throw when line config resolves to no agents", () => {
    writeTestStateFile({}, { line: { index: 0 }, "tier-2": { index: 0 } });
    mockLineConfig(["nonexistent"]);

    const report = buildStateReport(tmpDir, { quiet: true });
    expect(report.scheduler.find((e) => e.key === "line")?.agentName).toBeNull();
    expect(report.scheduler.find((e) => e.key === "tier-2")).toBeDefined();
  });

  it("includes agents array in report", () => {
    writeTestStateFile({
      opencode: { failureTimes: [], disabledTo: null, deactivated: true },
      agy: { failureTimes: ["2026-05-23T09:25:00.000Z"], disabledTo: null },
      "mm-code": { failureTimes: [], disabledTo: null },
    });

    const report = buildStateReport(tmpDir);
    expect(report.agents.length).toBeGreaterThanOrEqual(3);
    expect(report.maxEntries).toBe(50);
    expect(report.scheduler[0]?.key).toBe("default");
  });

  it("marks deactivated agents", () => {
    writeTestStateFile({
      opencode: { failureTimes: [], disabledTo: null, deactivated: true },
    });

    const report = buildStateReport(tmpDir);
    const oc = report.agents.find((a) => a.name === "opencode");
    expect(oc).toBeDefined();
    expect(oc!.deactivated).toBe(true);
    expect(oc!.failures).toBe(0);
  });

  it("counts failures and tracks lastFailure", () => {
    writeTestStateFile({
      qwen: {
        failureTimes: ["2026-05-23T09:25:00.000Z", "2026-05-23T09:45:00.000Z"],
        disabledTo: null,
      },
    });

    const report = buildStateReport(tmpDir);
    const qwen = report.agents.find((a) => a.name === "qwen");
    expect(qwen).toBeDefined();
    expect(qwen!.failures).toBe(2);
    expect(qwen!.lastFailure).toBe("2026-05-23T09:45:00.000Z");
  });

  it("surfaces disabledTo when set", () => {
    const future = new Date(Date.now() + 3_600_000).toISOString();
    writeTestStateFile({
      agy: { failureTimes: ["2026-05-23T09:25:00.000Z"], disabledTo: future },
    });

    const report = buildStateReport(tmpDir);
    const gem = report.agents.find((a) => a.name === "agy");
    expect(gem).toBeDefined();
    expect(gem!.disabledTo).toBe(future);
  });

  it("returns empty agents when no health data", () => {
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(path.join(tmpDir, "state.json"), JSON.stringify({ scheduler: {} }));

    const report = buildStateReport(tmpDir);
    expect(report.agents).toEqual([]);
  });

  it("handles line scheduler key (uses line mode agents)", () => {
    mockLineConfig(["kilo", "agy", "mm-code", "glm-code", "mock"]);
    writeTestStateFile(
      {
        agy: { failureTimes: [], disabledTo: null, deactivated: false },
        "mm-code": { failureTimes: [], disabledTo: null, deactivated: false },
        "glm-code": { failureTimes: [], disabledTo: null, deactivated: false },
        kilo: { failureTimes: [], disabledTo: null, deactivated: false },
        mock: { failureTimes: [], disabledTo: null, deactivated: false },
      },
      {
        line: { index: 1 }, // agy is index 1 in tier 3
      },
    );

    const report = buildStateReport(tmpDir);
    expect(report.scheduler[0]?.key).toBe("line");
    expect(report.scheduler[0]?.agentName).toBe("agy");
    expect(report.scheduler[0]?.index).toBe(1);
  });

  it("emits null (not undefined) for absent optional fields — stable JSON keys", () => {
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(
      path.join(tmpDir, "state.json"),
      JSON.stringify({
        scheduler: { "tier-2": { index: 999 } },
        agents: { qwen: { failureTimes: [], disabledTo: null } },
      }),
    );

    const report = buildStateReport(tmpDir);
    expect("maxEntries" in report).toBe(true);
    expect(report.maxEntries).toBeNull();
    expect(report.scheduler[0]?.agentName).toBeNull();
    expect("agentName" in (report.scheduler[0] ?? {})).toBe(true);
    const qwen = report.agents.find((a) => a.name === "qwen");
    expect(qwen?.lastFailure).toBeNull();
    expect(qwen?.disabledTo).toBeNull();
    // JSON round-trip is lossless: no keys vanish via undefined-drop
    expect(JSON.parse(JSON.stringify(report))).toEqual(report);
  });

  it("quiet mode emits no console.warn/console.error", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(path.join(tmpDir, "state.json"), JSON.stringify({ scheduler: { "tier-2": { index: 0 } } }));
    delete process.env.AT_HMAC_SECRET;
    buildStateReport(tmpDir, { quiet: true });
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
    errSpy.mockRestore();
  });
});

describe("formatStateReport", () => {
  it("shows DEACTIVATED label", () => {
    writeTestStateFile({
      agy: { failureTimes: [], disabledTo: null, deactivated: true },
    });

    const out = formatStateReport(tmpDir);
    expect(out).toContain("DEACTIVATED");
    expect(out).toContain("agy");
  });

  it("shows failure count and relative time", () => {
    writeTestStateFile({
      qwen: {
        failureTimes: ["2026-05-23T09:25:00.000Z", "2026-05-23T09:45:00.000Z"],
        disabledTo: null,
      },
    });

    const out = formatStateReport(tmpDir);
    expect(out).toContain("2 failures");
    expect(out).toContain("last:");
    expect(out).toContain("ago");
  });

  it('shows "ok" for healthy agents', () => {
    writeTestStateFile({
      "mm-code": { failureTimes: [], disabledTo: null },
    });

    const out = formatStateReport(tmpDir);
    expect(out).toContain("mm-code: ok");
  });

  it("shows disabled-until with relative time", () => {
    const future = new Date(Date.now() + 3_600_000).toISOString();
    writeTestStateFile({
      agy: { failureTimes: [], disabledTo: future },
    });

    const out = formatStateReport(tmpDir);
    expect(out).toContain("disabled until");
    expect(out).toContain("from now");
  });

  it("formats line scheduler key in state report", () => {
    mockLineConfig(["kilo", "agy", "mm-code", "glm-code", "mock"]);
    writeTestStateFile(
      {
        agy: { failureTimes: [], disabledTo: null, deactivated: false },
        "mm-code": { failureTimes: [], disabledTo: null, deactivated: false },
        "glm-code": { failureTimes: [], disabledTo: null, deactivated: false },
        kilo: { failureTimes: [], disabledTo: null, deactivated: false },
        mock: { failureTimes: [], disabledTo: null, deactivated: false },
      },
      {
        line: { index: 1 }, // agy
      },
    );

    const out = formatStateReport(tmpDir);
    expect(out).toContain("- line → index 1 (agy)");
  });

  it("appends a mermaid diagram of the scheduler when state exists", () => {
    mockLineConfig(["kilo", "agy", "mm-code", "glm-code", "mock"]);
    writeTestStateFile(
      {
        agy: { failureTimes: [], disabledTo: null, deactivated: false },
        "mm-code": { failureTimes: [], disabledTo: null, deactivated: false },
        "glm-code": { failureTimes: [], disabledTo: null, deactivated: false },
        kilo: { failureTimes: [], disabledTo: null, deactivated: false },
        mock: { failureTimes: [], disabledTo: null, deactivated: false },
      },
      {
        line: { index: 1 }, // agy
      },
    );

    const out = formatStateReport(tmpDir);
    expect(out).toContain("```mermaid");
    expect(out).toContain("flowchart LR");
    expect(out).toContain('subgraph g0["line"]');
    expect(out).toContain('(("agy")):::current');
  });

  it("omits the mermaid diagram when there is no scheduler state", () => {
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(path.join(tmpDir, "state.json"), JSON.stringify({ agents: {} }));

    const out = formatStateReport(tmpDir);
    expect(out).not.toContain("```mermaid");
  });
});
