import { beforeEach, describe, expect, it } from "vitest";
import type { RunRecord } from "../../src/run-store";
import { filteredSessions2, filterRuns } from "../../src/tui/store/filtered-sessions";
import { setSelectedRunId, setSessions } from "../../src/tui/store/sessions";
import { setSidebarFilter } from "../../src/tui/store/ui";

const mockRun = (runId: string, overrides: Partial<RunRecord> = {}): RunRecord => ({
  runId,
  agent: "mm-code",
  tier: 2,
  pid: 99999,
  prompt: "refactor the scheduler",
  logFile: "/tmp/test.log",
  startedAt: new Date().toISOString(),
  finishedAt: null,
  exitCode: null,
  status: "running",
  name: "unnamed",
  ...overrides,
});

const RUNS: RunRecord[] = [
  mockRun("alpha-111", { agent: "kimi", prompt: "fix the flaky test" }),
  mockRun("beta-222", { agent: "opencode", prompt: "add kanban lint", status: "done" }),
  mockRun("gamma-333", { agent: "glm-code", prompt: "document the tiers", status: "failed" }),
];

describe("filterRuns", () => {
  it("returns every run when the filter is blank", () => {
    expect(filterRuns(RUNS, "")).toEqual(RUNS);
    expect(filterRuns(RUNS, "   ")).toEqual(RUNS);
  });

  it("matches on run id", () => {
    expect(filterRuns(RUNS, "beta-2").map((r) => r.runId)).toEqual(["beta-222"]);
  });

  it("matches on agent name", () => {
    expect(filterRuns(RUNS, "opencode").map((r) => r.runId)).toEqual(["beta-222"]);
  });

  it("matches on prompt text", () => {
    expect(filterRuns(RUNS, "kanban").map((r) => r.runId)).toEqual(["beta-222"]);
    expect(filterRuns(RUNS, "flaky").map((r) => r.runId)).toEqual(["alpha-111"]);
  });

  it("is case-insensitive", () => {
    expect(filterRuns(RUNS, "GLM-CODE").map((r) => r.runId)).toEqual(["gamma-333"]);
    expect(filterRuns(RUNS, "FIX the").map((r) => r.runId)).toEqual(["alpha-111"]);
  });

  it("keeps the input order and returns nothing when no run matches", () => {
    expect(filterRuns(RUNS, "code").map((r) => r.runId)).toEqual(["beta-222", "gamma-333"]);
    expect(filterRuns(RUNS, "nope")).toEqual([]);
  });
});

describe("filteredSessions2", () => {
  beforeEach(() => {
    setSidebarFilter("");
    setSelectedRunId(null);
    setSessions(RUNS);
  });

  it("passes all sessions through while the filter is empty", () => {
    expect(filteredSessions2().map((r) => r.runId)).toEqual(["alpha-111", "beta-222", "gamma-333"]);
  });

  it("reacts to the sidebar filter", () => {
    setSidebarFilter("glm");
    expect(filteredSessions2().map((r) => r.runId)).toEqual(["gamma-333"]);

    setSidebarFilter("");
    expect(filteredSessions2()).toHaveLength(3);
  });

  it("reacts to the underlying sessions signal", () => {
    setSessions([mockRun("delta-444", { agent: "qwen", prompt: "retry me" })]);
    setSidebarFilter("qwen");
    expect(filteredSessions2()).toHaveLength(1);
    expect(filteredSessions2()[0].runId).toBe("delta-444");
  });
});
