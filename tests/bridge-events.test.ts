/**
 * T29: `at bridge` events + discuss + health resources.
 * Contract: docs/bridge.md
 */

import { execSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

const cliPath = path.join(__dirname, "..", "dist", "cli.js");

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

function makeEvent(seq: number, runId: string, type: string, text: string): Record<string, unknown> {
  return {
    runId,
    agent: "mock",
    ts: new Date(2026, 0, 1, 0, 0, seq).toISOString(),
    seq,
    type,
    text,
  };
}

function writeEvents(stateDir: string, runId: string, events: Record<string, unknown>[]): void {
  const dir = path.join(stateDir, "events");
  mkdirSync(dir, { recursive: true });
  const lines = events.map((e) => JSON.stringify(e)).join("\n");
  writeFileSync(path.join(dir, `${runId}.jsonl`), lines ? `${lines}\n` : "", "utf8");
}

function writeDiscuss(stateDir: string, runId: string, entries: Record<string, unknown>[]): void {
  const dir = path.join(stateDir, "events");
  mkdirSync(dir, { recursive: true });
  const lines = entries.map((e) => JSON.stringify(e)).join("\n");
  writeFileSync(path.join(dir, `${runId}.discuss.jsonl`), lines ? `${lines}\n` : "", "utf8");
}

function writeRuns(stateDir: string, runs: Record<string, unknown>[]): void {
  const lines = runs.map((r) => JSON.stringify(r)).join("\n");
  writeFileSync(path.join(stateDir, "runs.jsonl"), lines ? `${lines}\n` : "", "utf8");
}

describe("at bridge — events + discuss + health (T29)", () => {
  beforeAll(() => {
    buildCli();
  }, 120000);

  // ── events ───────────────────────────────────────────────────────────────

  it("events tail [runId] returns stored events", () => {
    const stateDir = mkdtempSync(path.join(os.tmpdir(), "at-bridge-events-"));
    seedStateDir(stateDir);
    try {
      writeEvents(stateDir, "r1", [
        makeEvent(1, "r1", "start", "go"),
        makeEvent(2, "r1", "output", "hello"),
        makeEvent(3, "r1", "done", "done"),
      ]);
      const r = runBridge(["bridge", "events", "tail", "r1"], "{}", { AT_STATE_DIR: stateDir });
      expect(r.exitCode).toBe(0);
      const out = JSON.parse(r.stdout);
      expect(out.ok).toBe(true);
      expect(Array.isArray(out.data)).toBe(true);
      expect(out.data.length).toBe(3);
      expect(out.data.map((e: { seq: number }) => e.seq)).toEqual([1, 2, 3]);
    } finally {
      rmSync(stateDir, { recursive: true, force: true });
    }
  });

  it("events tail respects since and limit", () => {
    const stateDir = mkdtempSync(path.join(os.tmpdir(), "at-bridge-events-since-"));
    seedStateDir(stateDir);
    try {
      writeEvents(stateDir, "r1", [
        makeEvent(1, "r1", "start", "a"),
        makeEvent(2, "r1", "output", "b"),
        makeEvent(3, "r1", "output", "c"),
        makeEvent(4, "r1", "done", "d"),
      ]);
      const r = runBridge(["bridge", "events", "tail", "r1"], JSON.stringify({ since: 1, limit: 2 }), {
        AT_STATE_DIR: stateDir,
      });
      const out = JSON.parse(r.stdout);
      expect(out.data.map((e: { seq: number }) => e.seq)).toEqual([2, 3]);
    } finally {
      rmSync(stateDir, { recursive: true, force: true });
    }
  });

  it("events tail without runId returns events for all runs", () => {
    const stateDir = mkdtempSync(path.join(os.tmpdir(), "at-bridge-events-all-"));
    seedStateDir(stateDir);
    try {
      writeEvents(stateDir, "r1", [makeEvent(1, "r1", "start", "r1 start")]);
      writeEvents(stateDir, "r2", [makeEvent(2, "r2", "start", "r2 start")]);
      const r = runBridge(["bridge", "events", "tail"], JSON.stringify({ limit: 10 }), { AT_STATE_DIR: stateDir });
      const out = JSON.parse(r.stdout);
      expect(out.data.length).toBe(2);
      expect(out.data.map((e: { runId: string }) => e.runId).sort()).toEqual(["r1", "r2"]);
    } finally {
      rmSync(stateDir, { recursive: true, force: true });
    }
  });

  // ── discuss ─────────────────────────────────────────────────────────────

  it("discuss thread [runId] returns the full thread", () => {
    const stateDir = mkdtempSync(path.join(os.tmpdir(), "at-bridge-discuss-thread-"));
    seedStateDir(stateDir);
    try {
      writeDiscuss(stateDir, "r1", [
        { id: "m1", from: "agent", kind: "question", text: "help?", ts: new Date().toISOString() },
        { id: "m2", from: "host", kind: "answer", text: "ok", replyTo: "m1", ts: new Date().toISOString() },
      ]);
      const r = runBridge(["bridge", "discuss", "thread", "r1"], "{}", { AT_STATE_DIR: stateDir });
      const out = JSON.parse(r.stdout);
      expect(out.ok).toBe(true);
      expect(out.data.length).toBe(2);
      expect(out.data[0]).toMatchObject({ id: "m1", kind: "question" });
    } finally {
      rmSync(stateDir, { recursive: true, force: true });
    }
  });

  it("discuss list --pending returns unanswered questions", () => {
    const stateDir = mkdtempSync(path.join(os.tmpdir(), "at-bridge-discuss-pending-"));
    seedStateDir(stateDir);
    try {
      writeDiscuss(stateDir, "r1", [
        { id: "m1", from: "agent", kind: "question", text: "open?", ts: new Date().toISOString() },
        { id: "m2", from: "agent", kind: "question", text: "closed?", ts: new Date().toISOString() },
        { id: "m3", from: "host", kind: "answer", text: "yes", replyTo: "m2", ts: new Date().toISOString() },
      ]);
      const r = runBridge(["bridge", "discuss", "list"], JSON.stringify({ runId: "r1", pending: true }), {
        AT_STATE_DIR: stateDir,
      });
      const out = JSON.parse(r.stdout);
      expect(out.data.length).toBe(1);
      expect(out.data[0]).toMatchObject({ id: "m1", text: "open?" });
    } finally {
      rmSync(stateDir, { recursive: true, force: true });
    }
  });

  it("discuss answer writes an answer and returns its id", () => {
    const stateDir = mkdtempSync(path.join(os.tmpdir(), "at-bridge-discuss-answer-"));
    seedStateDir(stateDir);
    try {
      writeRuns(stateDir, [{ runId: "r1", agent: "mock", tier: 4, prompt: "p" }]);
      writeDiscuss(stateDir, "r1", [
        { id: "m1", from: "agent", kind: "question", text: "q", ts: new Date().toISOString() },
      ]);
      const r = runBridge(["bridge", "discuss", "answer"], JSON.stringify({ runId: "r1", qid: "m1", text: "a" }), {
        AT_STATE_DIR: stateDir,
      });
      const out = JSON.parse(r.stdout);
      expect(out.ok).toBe(true);
      expect(typeof out.data.id).toBe("string");

      const pending = runBridge(["bridge", "discuss", "list"], JSON.stringify({ runId: "r1", pending: true }), {
        AT_STATE_DIR: stateDir,
      });
      expect(JSON.parse(pending.stdout).data.length).toBe(0);
    } finally {
      rmSync(stateDir, { recursive: true, force: true });
    }
  });

  it("discuss say writes a host say and returns its id", () => {
    const stateDir = mkdtempSync(path.join(os.tmpdir(), "at-bridge-discuss-say-"));
    seedStateDir(stateDir);
    try {
      writeRuns(stateDir, [{ runId: "r1", agent: "mock", tier: 4, prompt: "p" }]);
      const r = runBridge(["bridge", "discuss", "say"], JSON.stringify({ runId: "r1", text: "continue" }), {
        AT_STATE_DIR: stateDir,
      });
      const out = JSON.parse(r.stdout);
      expect(out.ok).toBe(true);
      expect(typeof out.data.id).toBe("string");

      const thread = runBridge(["bridge", "discuss", "thread", "r1"], "{}", { AT_STATE_DIR: stateDir });
      expect(JSON.parse(thread.stdout).data).toEqual(
        expect.arrayContaining([expect.objectContaining({ kind: "say", text: "continue" })]),
      );
    } finally {
      rmSync(stateDir, { recursive: true, force: true });
    }
  });

  it("discuss verb without runId returns USAGE error", () => {
    const stateDir = mkdtempSync(path.join(os.tmpdir(), "at-bridge-discuss-usage-"));
    seedStateDir(stateDir);
    try {
      const r = runBridge(["bridge", "discuss", "list"], "{}", { AT_STATE_DIR: stateDir });
      expect(r.exitCode).toBe(2);
      const out = JSON.parse(r.stdout);
      expect(out.error.code).toBe("USAGE");
    } finally {
      rmSync(stateDir, { recursive: true, force: true });
    }
  });

  // ── health ───────────────────────────────────────────────────────────────

  it("health get returns scheduler + agent snapshot", () => {
    const stateDir = mkdtempSync(path.join(os.tmpdir(), "at-bridge-health-"));
    seedStateDir(stateDir);
    try {
      writeFileSync(
        path.join(stateDir, "state.json"),
        JSON.stringify({
          scheduler: { "tier-2": { index: 1 } },
          agents: {
            "mm-code": { failureTimes: [], disabledTo: null, deactivated: true },
          },
        }),
        "utf8",
      );
      const r = runBridge(["bridge", "health", "get"], "{}", { AT_STATE_DIR: stateDir });
      const out = JSON.parse(r.stdout);
      expect(out.ok).toBe(true);
      expect(out.data.scheduler).toEqual(expect.arrayContaining([expect.objectContaining({ key: "tier-2" })]));
      expect(out.data.agents).toEqual(
        expect.arrayContaining([expect.objectContaining({ name: "mm-code", deactivated: true })]),
      );
    } finally {
      rmSync(stateDir, { recursive: true, force: true });
    }
  });
});
