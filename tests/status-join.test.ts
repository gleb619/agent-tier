import { mkdirSync, rmSync, writeFileSync } from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type RunRecord, saveRuns } from "../src/run-store";
import * as stateDirModule from "../src/state-dir";
import { buildStateReportFor, formatStateReports, formatStatusTable, runStatus } from "../src/status";

// --- Fixtures ---

const baseRun: RunRecord = {
  runId: "aaaa1111",
  agent: "opencode",
  tier: 2,
  pid: 28451,
  prompt: "fix the bug",
  logFile: "/tmp/at-logs/at-test-opencode.log",
  startedAt: new Date("2026-10-10T10:00:00.000Z").toISOString(),
  finishedAt: null,
  exitCode: null,
  status: "running",
  name: "unnamed",
};

const root = path.join(os.tmpdir(), "at-status-join-test-" + process.pid);
const projectDir = path.join(root, "project", ".at");
const homeDir = path.join(root, "home", ".at");

function writeState(dir: string, state: unknown): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "state.json"), JSON.stringify(state, null, 2));
}

beforeEach(() => {
  rmSync(root, { recursive: true, force: true });
  mkdirSync(projectDir, { recursive: true });
  mkdirSync(homeDir, { recursive: true });
  // Redirect homedir so 'global' scope resolves to our fixture dir
  vi.spyOn(os, "homedir").mockReturnValue(path.join(root, "home"));
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(root, { recursive: true, force: true });
});

// --- resolveStatusDirs ---

describe("resolveStatusDirs", () => {
  it("returns only explicit dir when given", () => {
    expect(stateDirModule.resolveStatusDirs("/tmp/explicit-at")).toEqual(["/tmp/explicit-at"]);
  });

  it("returns only AT_STATE_DIR when set", () => {
    process.env.AT_STATE_DIR = "/tmp/env-at";
    try {
      expect(stateDirModule.resolveStatusDirs()).toEqual(["/tmp/env-at"]);
    } finally {
      delete process.env.AT_STATE_DIR;
    }
  });

  it("joins project .at and home .at when project has own state", () => {
    writeState(projectDir, {});
    mkdirSync(path.join(root, "project", ".git"), { recursive: true });
    vi.spyOn(process, "cwd").mockReturnValue(path.join(root, "project"));
    const dirs = stateDirModule.resolveStatusDirs();
    expect(dirs).toEqual([projectDir, homeDir]);
  });

  it("returns only home when project has no .at state", () => {
    mkdirSync(path.join(root, "project", ".git"), { recursive: true });
    vi.spyOn(process, "cwd").mockReturnValue(path.join(root, "project"));
    expect(stateDirModule.resolveStatusDirs()).toEqual([homeDir]);
  });
});

// --- runStatus joined output ---

describe("runStatus with joined state dirs", () => {
  let stdout: string[];
  beforeEach(() => {
    stdout = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      stdout.push(String(chunk));
      return true;
    });
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      stdout.push(args.join(" "));
    });
  });

  it("text: shows runs and scheduler entries from both scopes, labeled", async () => {
    saveRuns(projectDir, [baseRun]);
    writeState(projectDir, {
      scheduler: { "tier-2": { index: 0 } },
      agents: { opencode: { failureTimes: [], disabledTo: null } },
    });
    const globalRun: RunRecord = {
      ...baseRun,
      runId: "bbbb2222",
      agent: "qwen",
      startedAt: "2026-10-10T09:00:00.000Z",
    };
    saveRuns(homeDir, [globalRun]);
    writeState(homeDir, {
      scheduler: { "tier-3": { index: 0 } },
      agents: { qwen: { failureTimes: [], disabledTo: null } },
    });

    await runStatus([projectDir, homeDir]);
    const out = stdout.join("");

    expect(out).toContain("aaaa1111");
    expect(out).toContain("bbbb2222");
    expect(out).toContain("[project] tier-2");
    expect(out).toContain("[global] tier-3");
    expect(out).toContain("qwen: ok");
    expect(out).toContain("opencode: ok");
  });

  it("json: merges runs (newest first, scoped) and state; single dir stays unscoped", async () => {
    saveRuns(projectDir, [baseRun]);
    writeState(projectDir, { scheduler: { "tier-2": { index: 0 } }, agents: {} });
    saveRuns(homeDir, [{ ...baseRun, runId: "bbbb2222", startedAt: "2026-10-10T09:00:00.000Z" }]);
    writeState(homeDir, { scheduler: { "tier-3": { index: 0 } }, agents: {} });

    await runStatus([projectDir, homeDir], { json: true });
    const joined = JSON.parse(stdout.join(""));
    expect(joined.runs.map((r: RunRecord) => r.runId)).toEqual(["aaaa1111", "bbbb2222"]);
    expect(joined.runs[0].scope).toBe("project");
    expect(joined.runs[1].scope).toBe("global");
    expect(joined.state.scheduler.map((e: { key: string; scope?: string }) => `${e.scope}:${e.key}`)).toEqual([
      "project:tier-2",
      "global:tier-3",
    ]);

    stdout = [];
    await runStatus([projectDir], { json: true });
    const single = JSON.parse(stdout.join(""));
    expect(single.runs[0].runId).toBe("aaaa1111");
    expect("scope" in single.runs[0]).toBe(false);
    expect("scope" in single.state.scheduler[0]).toBe(false);
  });

  it("dedupes runs by runId, project copy wins", async () => {
    saveRuns(projectDir, [{ ...baseRun, status: "done" }]);
    saveRuns(homeDir, [{ ...baseRun, status: "failed" }]);

    await runStatus([projectDir, homeDir], { json: true });
    const joined = JSON.parse(stdout.join(""));
    expect(joined.runs).toHaveLength(1);
    expect(joined.runs[0].status).toBe("done");
    expect(joined.runs[0].scope).toBe("project");
  });

  it("merges agent health by name, project wins on conflict", async () => {
    writeState(projectDir, {
      scheduler: {},
      agents: { qwen: { failureTimes: ["2026-10-01T00:00:00.000Z"], disabledTo: null } },
    });
    writeState(homeDir, {
      scheduler: {},
      agents: { qwen: { failureTimes: [], disabledTo: null }, kilo: { failureTimes: [], disabledTo: null } },
    });

    await runStatus([projectDir, homeDir], { json: true });
    const joined = JSON.parse(stdout.join(""));
    const qwen = joined.state.agents.find((a: { name: string }) => a.name === "qwen");
    expect(joined.state.agents).toHaveLength(2);
    expect(qwen.failures).toBe(1);
  });
});

// --- Formatting helpers ---

describe("formatStatusTable with scope", () => {
  it("adds SCOPE column when runs carry scope", () => {
    const scoped = { ...baseRun, scope: "project" } as RunRecord & { scope: string };
    const out = formatStatusTable([scoped]);
    expect(out).toContain("SCOPE");
    expect(out).toContain("project");
  });

  it("no SCOPE column for plain runs (back-compat)", () => {
    expect(formatStatusTable([baseRun])).not.toContain("SCOPE");
  });

  it("SCOPE column shown when joined, even if all runs come from one source", () => {
    const scoped = { ...baseRun, scope: "global" } as RunRecord & { scope: string };
    const out = formatStatusTable([scoped]);
    expect(out).toContain("SCOPE");
    expect(out).toContain("global");
  });
});

describe("formatStateReports", () => {
  it("single dir output identical to formatStateReport (no scope labels)", () => {
    writeState(projectDir, { scheduler: { "tier-2": { index: 0 } }, agents: {} });
    const out = formatStateReports([projectDir]);
    expect(out).toContain("- tier-2 → index 0");
    expect(out).not.toContain("[project]");
  });

  it("labels scheduler entries per scope", () => {
    writeState(projectDir, { scheduler: { "tier-2": { index: 0 } }, agents: {} });
    writeState(homeDir, { scheduler: { "tier-3": { index: 0 } }, agents: {} });
    const out = formatStateReports([projectDir, homeDir]);
    expect(out).toContain("- [project] tier-2 → index 0");
    expect(out).toContain("- [global] tier-3 → index 0");
  });
});

describe("buildStateReportFor", () => {
  it("joins scheduler + health when given multiple dirs", () => {
    writeState(projectDir, {
      scheduler: { "tier-2": { index: 0 } },
      agents: { opencode: { failureTimes: [], disabledTo: null } },
    });
    writeState(homeDir, {
      scheduler: { "tier-3": { index: 0 } },
      agents: { qwen: { failureTimes: [], disabledTo: null } },
    });
    const report = buildStateReportFor([projectDir, homeDir]);
    expect(report.scheduler.map((e) => `${e.scope}:${e.key}`)).toEqual(["project:tier-2", "global:tier-3"]);
    expect(report.agents.map((a) => a.name).sort()).toEqual(["opencode", "qwen"]);
  });

  it("single dir → unscoped report (back-compat)", () => {
    writeState(projectDir, { scheduler: { "tier-2": { index: 0 } }, agents: {} });
    const report = buildStateReportFor([projectDir]);
    expect(report.scheduler).toHaveLength(1);
    expect(report.scheduler[0].scope).toBeUndefined();
  });
});
