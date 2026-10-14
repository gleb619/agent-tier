/**
 * Regression: 'at status --json' must emit JSON, not markdown.
 * Bug: root program defines --json (stdin JSON mode) and consumes it
 * before subcommand options resolve, so status subcommand sees --json=false.
 */

import { execSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

const cliPath = path.join(__dirname, "..", "dist", "cli.js");

function buildCli(): void {
  execSync("npm run build", { stdio: "inherit" });
}

function seedRun(stateDir: string, runId: string, agent: string): void {
  mkdirSync(stateDir, { recursive: true });
  const run = {
    runId,
    agent,
    tier: 2,
    pid: 12345,
    prompt: "seeded",
    logFile: "/tmp/at-logs/seeded.log",
    startedAt: new Date().toISOString(),
    finishedAt: null,
    exitCode: null,
    status: "done",
    name: "seeded",
  };
  writeFileSync(path.join(stateDir, "runs.jsonl"), `${JSON.stringify(run)}\n`, "utf8");
  writeFileSync(path.join(stateDir, "state.json"), "{}", "utf8");
}

function runCli(args: string[], env: Record<string, string>): { exitCode: number; stdout: string; stderr: string } {
  const result = spawnSync("node", [cliPath, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  return {
    exitCode: result.status ?? -1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

describe("at status --json (real CLI)", () => {
  beforeAll(() => {
    buildCli();
  }, 60000);

  it("status --json emits valid JSON, not markdown", () => {
    const stateDir = mkdtempSync(path.join(os.tmpdir(), "at-status-json-"));
    seedRun(stateDir, "abc12345", "opencode");
    try {
      const r = runCli(["status", "--json"], { AT_STATE_DIR: stateDir });
      expect(r.exitCode).toBe(0);
      // must be valid JSON
      expect(() => JSON.parse(r.stdout)).not.toThrow();
      const parsed = JSON.parse(r.stdout) as { total: number; runs: Array<{ runId: string; agent: string }> };
      expect(parsed.total).toBeGreaterThanOrEqual(1);
      expect(parsed.runs[0].runId).toBe("abc12345");
      // must not contain markdown table header
      expect(r.stdout).not.toContain("| RUN ");
      expect(r.stdout).not.toContain("# Runs");
    } finally {
      rmSync(stateDir, { recursive: true, force: true });
    }
  });

  it("status --json works when no runs", () => {
    const stateDir = mkdtempSync(path.join(os.tmpdir(), "at-status-json-empty-"));
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(path.join(stateDir, "runs.jsonl"), "", "utf8");
    writeFileSync(path.join(stateDir, "state.json"), "{}", "utf8");
    try {
      const r = runCli(["status", "--json"], { AT_STATE_DIR: stateDir });
      expect(r.exitCode).toBe(0);
      const parsed = JSON.parse(r.stdout) as { total: number; runs: unknown[] };
      expect(parsed.total).toBe(0);
      expect(parsed.runs).toEqual([]);
    } finally {
      rmSync(stateDir, { recursive: true, force: true });
    }
  });

  it("status (no --json) still emits markdown table", () => {
    const stateDir = mkdtempSync(path.join(os.tmpdir(), "at-status-md-"));
    seedRun(stateDir, "xyz98765", "opencode");
    try {
      const r = runCli(["status"], { AT_STATE_DIR: stateDir });
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toContain("# Runs");
      expect(r.stdout).toContain("| RUN ");
    } finally {
      rmSync(stateDir, { recursive: true, force: true });
    }
  });

  it("status --no-chop <runId> does not consume --no-chop as global", () => {
    // When user does `at status --no-chop <runId>`, --no-chop is a status subcommand
    // option, not a global one. It should not trigger the global chop-disable path.
    // We just verify the command reaches the runId log path without crashing.
    const stateDir = mkdtempSync(path.join(os.tmpdir(), "at-status-nochop-"));
    seedRun(stateDir, "qwer4321", "opencode");
    const logDir = mkdtempSync(path.join(os.tmpdir(), "at-status-nochop-logs-"));
    const logFile = path.join(logDir, "at-seed-opencode.log");
    writeFileSync(logFile, "hello world\n", "utf8");
    // rewrite run to use real logFile
    const runsFile = path.join(stateDir, "runs.jsonl");
    const run = {
      runId: "qwer4321",
      agent: "opencode",
      tier: 2,
      pid: 12345,
      prompt: "seeded",
      logFile,
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      exitCode: 0,
      status: "done",
      name: "seeded",
    };
    writeFileSync(runsFile, `${JSON.stringify(run)}\n`, "utf8");
    try {
      const r = runCli(["status", "--no-chop", "qwer4321"], { AT_STATE_DIR: stateDir });
      expect(r.exitCode).toBe(0);
      // raw content (not chopped) is preserved
      expect(r.stdout).toContain("hello world");
    } finally {
      rmSync(stateDir, { recursive: true, force: true });
      rmSync(logDir, { recursive: true, force: true });
    }
  });
});

describe("global --json and --no-chop still work on root (regression)", () => {
  beforeAll(() => {
    buildCli();
  }, 60000);

  it("at --json reads JSON from stdin (root option still works)", () => {
    // Use mock agent so it does not actually invoke external binaries
    const logDir = mkdtempSync(path.join(os.tmpdir(), "at-global-json-"));
    const result = spawnSync("node", [cliPath, "--json", "-a", "mock", "--log-dir", logDir], {
      encoding: "utf8",
      input: JSON.stringify({ prompt: "global json prompt", agent: "mock" }),
      // isolate from the real ~/.at (jsonDefaults, line config, running-run limit)
      env: { ...process.env, HOME: logDir, MOCK_BIN: path.resolve(__dirname, "..", "bin", "mock-agent") },
    });
    expect(result.status).toBe(0);
    const out = (result.stdout ?? "") + (result.stderr ?? "");
    // mock agent echoes the prompt into its log; main check: did not crash
    // and did not misinterpret --json as status subcommand option
    expect(out).not.toContain("No subcommand specified");
  });

  it("at --no-chop -p ... still works (root option still works)", () => {
    const logDir = mkdtempSync(path.join(os.tmpdir(), "at-global-nochop-"));
    const result = spawnSync(
      "node",
      [cliPath, "--no-chop", "-a", "mock", "-s", "-p", "global nochop", "--log-dir", logDir],
      {
        encoding: "utf8",
        env: { ...process.env, HOME: logDir, MOCK_BIN: path.resolve(__dirname, "..", "bin", "mock-agent") },
      },
    );
    expect(result.status).toBe(0);
  });
});
