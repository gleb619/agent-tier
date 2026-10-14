/**
 * T27: `at bridge` read verbs — runs, status, agents health, feedback,
 * kanban, config. Contract: docs/bridge.md.
 */

import { execSync, spawnSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

const cliPath = path.join(__dirname, "..", "dist", "cli.js");

// Build only when dist is missing: other CLI test files build unconditionally
// and concurrent full builds (tsc + vite + go) race each other.
function buildCli(): void {
  if (existsSync(cliPath)) return;
  execSync("npm run build", { stdio: "inherit" });
}

interface CliResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

function runBridge(args: string[], stdin: string, env: Record<string, string>): CliResult {
  const result = spawnSync("node", [cliPath, ...args], {
    encoding: "utf8",
    input: stdin,
    env: { ...process.env, ...env },
  });
  return {
    exitCode: result.status ?? -1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function seedStateDir(stateDir: string): void {
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(path.join(stateDir, "state.json"), "{}", "utf8");
}

interface FixtureRun {
  runId: string;
  agent: string;
  tier: number;
  pid: number;
  prompt: string;
  logFile: string;
  startedAt: string;
  finishedAt: string | null;
  exitCode: number | null;
  status: "running" | "done" | "failed" | "stuck";
  name: string;
}

function runFixture(overrides: Partial<FixtureRun>): FixtureRun {
  return {
    runId: "r1",
    agent: "mock",
    tier: 4,
    pid: 999999,
    prompt: "do the thing",
    logFile: "/tmp/r1.log",
    startedAt: "2026-10-14T10:00:00.000Z",
    finishedAt: "2026-10-14T10:05:00.000Z",
    exitCode: 0,
    status: "done",
    name: "test run",
    ...overrides,
  };
}

function seedRuns(stateDir: string): void {
  const runs = [
    runFixture({ runId: "r1", agent: "mock", status: "done", startedAt: "2026-10-14T10:00:00.000Z" }),
    runFixture({ runId: "r2", agent: "codex", status: "failed", startedAt: "2026-10-14T09:00:00.000Z" }),
    runFixture({ runId: "r3", agent: "mock", status: "running", startedAt: "2026-10-14T11:00:00.000Z" }),
  ];
  writeFileSync(path.join(stateDir, "runs.jsonl"), `${runs.map((r) => JSON.stringify(r)).join("\n")}\n`, "utf8");
}

interface FixtureFeedback {
  id: string;
  kind: "bug" | "improvement" | "note";
  text: string;
  agent?: string;
  status: "open" | "resolved" | "wontfix";
  tags?: string[];
  createdAt: string;
  updatedAt: string;
}

function seedFeedback(stateDir: string): void {
  const entries: FixtureFeedback[] = [
    {
      id: "fb1a2b",
      kind: "bug",
      text: "first bug",
      agent: "mock",
      status: "open",
      tags: ["ui"],
      createdAt: "2026-10-14T10:00:00.000Z",
      updatedAt: "2026-10-14T10:00:00.000Z",
    },
    {
      id: "fb3c4d",
      kind: "note",
      text: "a note",
      status: "resolved",
      createdAt: "2026-10-13T10:00:00.000Z",
      updatedAt: "2026-10-13T10:00:00.000Z",
    },
  ];
  writeFileSync(path.join(stateDir, "feedback.jsonl"), `${entries.map((e) => JSON.stringify(e)).join("\n")}\n`, "utf8");
}

const BOARD_MD = `<!-- at-kanban -->
<!-- status-legend: Backlog, In Progress, Blocked, Done -->

## Task Board

| ID  | Status  | Title      | Description | Priority | Owner | Blocks | Blocked By | Plan File |
| :-- | :------ | :--------- | :---------- | :------- | :---- | :----- | :--------- | :---------- |
| T1  | Backlog | first task | do it       | High     | loop  | T2     | -          | -           |
| T2  | Backlog | second     | do it too   | Medium   | loop  | -      | T1         | -           |
`;

describe("at bridge — read verbs (T27)", () => {
  beforeAll(() => {
    buildCli();
  }, 120000);

  it("runs list → all fixture runs", () => {
    const stateDir = mkdtempSync(path.join(os.tmpdir(), "at-br-runs-"));
    seedStateDir(stateDir);
    seedRuns(stateDir);
    try {
      const r = runBridge(["bridge", "runs", "list"], "{}", { AT_STATE_DIR: stateDir });
      expect(r.exitCode).toBe(0);
      const out = JSON.parse(r.stdout);
      expect(out.ok).toBe(true);
      expect(Array.isArray(out.data)).toBe(true);
      expect(out.data.map((x: FixtureRun) => x.runId).sort()).toEqual(["r1", "r2", "r3"]);
    } finally {
      rmSync(stateDir, { recursive: true, force: true });
    }
  });

  it("runs list filters by agent, status and limit", () => {
    const stateDir = mkdtempSync(path.join(os.tmpdir(), "at-br-runsf-"));
    seedStateDir(stateDir);
    seedRuns(stateDir);
    try {
      const byAgent = runBridge(["bridge", "runs", "list"], JSON.stringify({ agent: "mock" }), {
        AT_STATE_DIR: stateDir,
      });
      expect(byAgent.exitCode).toBe(0);
      let data = JSON.parse(byAgent.stdout).data as FixtureRun[];
      expect(data.map((x) => x.runId).sort()).toEqual(["r1", "r3"]);

      const byStatus = runBridge(["bridge", "runs", "list"], JSON.stringify({ status: "failed" }), {
        AT_STATE_DIR: stateDir,
      });
      data = JSON.parse(byStatus.stdout).data as FixtureRun[];
      expect(data.map((x) => x.runId)).toEqual(["r2"]);

      const limited = runBridge(["bridge", "runs", "list"], JSON.stringify({ limit: 2 }), {
        AT_STATE_DIR: stateDir,
      });
      data = JSON.parse(limited.stdout).data as FixtureRun[];
      expect(data).toHaveLength(2);

      const badLimit = runBridge(["bridge", "runs", "list"], JSON.stringify({ limit: -1 }), {
        AT_STATE_DIR: stateDir,
      });
      expect(badLimit.exitCode).toBe(2);
      expect(JSON.parse(badLimit.stdout).error.code).toBe("USAGE");
    } finally {
      rmSync(stateDir, { recursive: true, force: true });
    }
  });

  it("runs get → single record; missing → NOT_FOUND exit 3", () => {
    const stateDir = mkdtempSync(path.join(os.tmpdir(), "at-br-runget-"));
    seedStateDir(stateDir);
    seedRuns(stateDir);
    try {
      const r = runBridge(["bridge", "runs", "get"], JSON.stringify({ id: "r2" }), { AT_STATE_DIR: stateDir });
      expect(r.exitCode).toBe(0);
      const out = JSON.parse(r.stdout);
      expect(out.ok).toBe(true);
      expect(out.data.runId).toBe("r2");
      expect(out.data.agent).toBe("codex");

      const missing = runBridge(["bridge", "runs", "get"], JSON.stringify({ id: "nope" }), {
        AT_STATE_DIR: stateDir,
      });
      expect(missing.exitCode).toBe(3);
      const err = JSON.parse(missing.stdout);
      expect(err.error.code).toBe("NOT_FOUND");

      const noId = runBridge(["bridge", "runs", "get"], "{}", { AT_STATE_DIR: stateDir });
      expect(noId.exitCode).toBe(2);
      expect(JSON.parse(noId.stdout).error.code).toBe("USAGE");
    } finally {
      rmSync(stateDir, { recursive: true, force: true });
    }
  });

  it("status get → object shaped like at status --json", () => {
    const stateDir = mkdtempSync(path.join(os.tmpdir(), "at-br-status-"));
    seedStateDir(stateDir);
    seedRuns(stateDir);
    try {
      const r = runBridge(["bridge", "status", "get"], "{}", { AT_STATE_DIR: stateDir });
      expect(r.exitCode).toBe(0);
      const out = JSON.parse(r.stdout);
      expect(out.ok).toBe(true);
      expect(out.data.total).toBe(3);
      expect(Array.isArray(out.data.runs)).toBe(true);
      expect(out.data.state).toBeDefined();
      expect(Array.isArray(out.data.state.scheduler)).toBe(true);
      expect(Array.isArray(out.data.state.agents)).toBe(true);
    } finally {
      rmSync(stateDir, { recursive: true, force: true });
    }
  });

  it("agents health → per-agent health entries", () => {
    const stateDir = mkdtempSync(path.join(os.tmpdir(), "at-br-health-"));
    seedStateDir(stateDir);
    try {
      const r = runBridge(["bridge", "agents", "health"], "{}", { AT_STATE_DIR: stateDir });
      expect(r.exitCode).toBe(0);
      const out = JSON.parse(r.stdout);
      expect(out.ok).toBe(true);
      expect(Array.isArray(out.data)).toBe(true);
      expect(out.data.length).toBeGreaterThan(0);
      for (const entry of out.data as Array<Record<string, unknown>>) {
        expect(typeof entry.name).toBe("string");
        expect(typeof entry.deactivated).toBe("boolean");
        expect(typeof entry.failures).toBe("number");
      }
    } finally {
      rmSync(stateDir, { recursive: true, force: true });
    }
  });

  it("feedback list with filter; feedback get by id; missing → NOT_FOUND", () => {
    const stateDir = mkdtempSync(path.join(os.tmpdir(), "at-br-fb-"));
    seedStateDir(stateDir);
    seedFeedback(stateDir);
    try {
      const all = runBridge(["bridge", "feedback", "list"], "{}", { AT_STATE_DIR: stateDir });
      expect(all.exitCode).toBe(0);
      let data = JSON.parse(all.stdout).data as Array<{ id: string }>;
      expect(data.map((x) => x.id)).toEqual(["fb1a2b", "fb3c4d"]);

      const open = runBridge(["bridge", "feedback", "list"], JSON.stringify({ status: "open" }), {
        AT_STATE_DIR: stateDir,
      });
      data = JSON.parse(open.stdout).data as Array<{ id: string }>;
      expect(data.map((x) => x.id)).toEqual(["fb1a2b"]);

      const byTag = runBridge(["bridge", "feedback", "list"], JSON.stringify({ tag: "ui" }), {
        AT_STATE_DIR: stateDir,
      });
      data = JSON.parse(byTag.stdout).data as Array<{ id: string }>;
      expect(data.map((x) => x.id)).toEqual(["fb1a2b"]);

      const limited = runBridge(["bridge", "feedback", "list"], JSON.stringify({ limit: 1 }), {
        AT_STATE_DIR: stateDir,
      });
      data = JSON.parse(limited.stdout).data as Array<{ id: string }>;
      expect(data).toHaveLength(1);

      const got = runBridge(["bridge", "feedback", "get"], JSON.stringify({ id: "fb1a2b" }), {
        AT_STATE_DIR: stateDir,
      });
      expect(got.exitCode).toBe(0);
      expect(JSON.parse(got.stdout).data.text).toBe("first bug");

      const missing = runBridge(["bridge", "feedback", "get"], JSON.stringify({ id: "ffff" }), {
        AT_STATE_DIR: stateDir,
      });
      expect(missing.exitCode).toBe(3);
      expect(JSON.parse(missing.stdout).error.code).toBe("NOT_FOUND");
    } finally {
      rmSync(stateDir, { recursive: true, force: true });
    }
  });

  it("kanban list / show / next against a fixture board", () => {
    const stateDir = mkdtempSync(path.join(os.tmpdir(), "at-br-kb-"));
    seedStateDir(stateDir);
    const boardFile = path.join(stateDir, "kanban.md");
    writeFileSync(boardFile, BOARD_MD, "utf8");
    const env = { AT_STATE_DIR: stateDir, AT_KANBAN_FILE: boardFile };
    try {
      const list = runBridge(["bridge", "kanban", "list"], "{}", env);
      expect(list.exitCode).toBe(0);
      const tasks = JSON.parse(list.stdout).data as Array<{ ID: string }>;
      expect(tasks.map((t) => t.ID)).toEqual(["T1", "T2"]);

      const show = runBridge(["bridge", "kanban", "show"], JSON.stringify({ id: "T2" }), env);
      expect(show.exitCode).toBe(0);
      const task = JSON.parse(show.stdout).data;
      expect(task.Title).toBe("second");
      expect(task.Status).toBe("Backlog");

      const missing = runBridge(["bridge", "kanban", "show"], JSON.stringify({ id: "T9" }), env);
      expect(missing.exitCode).toBe(3);
      expect(JSON.parse(missing.stdout).error.code).toBe("NOT_FOUND");

      const next = runBridge(["bridge", "kanban", "next"], "{}", env);
      expect(next.exitCode).toBe(0);
      const sel = JSON.parse(next.stdout).data;
      expect(sel.type).toBe("next");
      expect(sel.task.ID).toBe("T1");
    } finally {
      rmSync(stateDir, { recursive: true, force: true });
    }
  });

  it("config get → signed config; unsigned/tampered → {}", () => {
    const home = mkdtempSync(path.join(os.tmpdir(), "at-br-cfg-"));
    const stateDir = path.join(home, ".at");
    seedStateDir(stateDir);
    const config = { line: ["mock"], tierOverrides: { mock: 4 } };
    const data = JSON.stringify(config);
    writeFileSync(path.join(stateDir, "config.json"), data, "utf8");
    const hmac = createHmac("sha256", process.env.AT_HMAC_SECRET ?? "at-config-hmac-v1")
      .update(data, "utf8")
      .digest("hex");
    writeFileSync(path.join(stateDir, "config.json.hmac"), hmac, "utf8");
    const env = { HOME: home, AT_STATE_DIR: stateDir };
    try {
      const r = runBridge(["bridge", "config", "get"], "{}", env);
      expect(r.exitCode).toBe(0);
      const out = JSON.parse(r.stdout);
      expect(out.ok).toBe(true);
      expect(out.data.line).toEqual(["mock"]);

      // tamper: config content no longer matches the HMAC
      writeFileSync(path.join(stateDir, "config.json"), JSON.stringify({ line: ["codex"] }), "utf8");
      const bad = runBridge(["bridge", "config", "get"], "{}", env);
      expect(bad.exitCode).toBe(0);
      expect(JSON.parse(bad.stdout).data).toEqual({});

      // no config file at all
      const empty = runBridge(["bridge", "config", "get"], "{}", {
        HOME: home,
        AT_STATE_DIR: mkdtempSync(path.join(os.tmpdir(), "at-br-cfg2-")),
      });
      expect(empty.exitCode).toBe(0);
      expect(JSON.parse(empty.stdout).data).toEqual({});
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
