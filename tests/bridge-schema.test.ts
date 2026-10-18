/**
 * T31: Bridge contract schema validation (docs/bridge.md envelope + exit codes).
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

function runBridge(args: string[], stdin: string, env: Record<string, string>) {
  const result = spawnSync("node", [cliPath, ...args], {
    encoding: "utf8",
    input: stdin,
    env: { ...process.env, ...env },
  });
  return { exitCode: result.status ?? -1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function seedStateDir(stateDir: string): void {
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(path.join(stateDir, "state.json"), "{}", "utf8");
}

describe("at bridge — contract schema (T31)", () => {
  beforeAll(() => {
    buildCli();
  }, 120000);

  it("success envelope matches docs/bridge.md: {ok:true, data:...}", () => {
    const stateDir = mkdtempSync(path.join(os.tmpdir(), "at-bridge-schema-ok-"));
    seedStateDir(stateDir);
    try {
      const r = runBridge(["bridge", "ping", "ping"], "{}", { AT_STATE_DIR: stateDir });
      expect(r.exitCode).toBe(0);
      const out = JSON.parse(r.stdout);
      expect(out.ok).toBe(true);
      expect(out.data).toBeDefined();
      expect(typeof out.error).toBe("undefined");
    } finally {
      rmSync(stateDir, { recursive: true, force: true });
    }
  });

  it("error envelope matches docs/bridge.md: {error:{code,message}} with exit 2/3", () => {
    const stateDir = mkdtempSync(path.join(os.tmpdir(), "at-bridge-schema-err-"));
    seedStateDir(stateDir);
    try {
      const r = runBridge(["bridge", "unknown", "ping"], "{}", { AT_STATE_DIR: stateDir });
      expect([2, 3]).toContain(r.exitCode);
      const out = JSON.parse(r.stdout);
      expect(out.ok).toBeUndefined();
      expect(out.error).toBeDefined();
      expect(typeof out.error.code).toBe("string");
      expect(typeof out.error.message).toBe("string");
    } finally {
      rmSync(stateDir, { recursive: true, force: true });
    }
  });

  it("covers every bridge resource/verb from docs/bridge.md with valid envelope", () => {
    const stateDir = mkdtempSync(path.join(os.tmpdir(), "at-bridge-schema-all-"));
    seedStateDir(stateDir);
    // kanban cases mutate the board: point at a throwaway file, never the repo's docs/kanban.md
    const board = path.join(stateDir, "kanban.md");
    writeFileSync(board, "| ID | Status | Title |\n| -- | ------ | ----- |\n| T1 | Backlog | seed |\n", "utf8");
    try {
      const cases: Array<{ args: string[]; stdin: string }> = [
        { args: ["bridge", "ping", "ping"], stdin: "{}" },
        { args: ["bridge", "agents", "list"], stdin: "{}" },
        { args: ["bridge", "agents", "health"], stdin: "{}" },
        { args: ["bridge", "runs", "list"], stdin: "{}" },
        { args: ["bridge", "runs", "get"], stdin: '{"id":"x"}' },
        { args: ["bridge", "runs", "stop"], stdin: "{}" },
        { args: ["bridge", "runs", "stop-all"], stdin: "{}" },
        { args: ["bridge", "status", "get"], stdin: "{}" },
        { args: ["bridge", "feedback", "list"], stdin: "{}" },
        { args: ["bridge", "feedback", "get"], stdin: '{"id":"f1"}' },
        { args: ["bridge", "feedback", "add"], stdin: '{"text":"test"}' },
        { args: ["bridge", "feedback", "update"], stdin: '{"id":"f1","text":"updated"}' },
        { args: ["bridge", "feedback", "resolve"], stdin: '{"id":"f1"}' },
        { args: ["bridge", "feedback", "rm"], stdin: '{"ids":["f1"]}' },
        { args: ["bridge", "kanban", "list"], stdin: "{}" },
        { args: ["bridge", "kanban", "show"], stdin: '{"id":"T1"}' },
        { args: ["bridge", "kanban", "next"], stdin: "{}" },
        { args: ["bridge", "kanban", "add"], stdin: '{"title":"new"}' },
        { args: ["bridge", "kanban", "status"], stdin: '{"id":"T1","status":"Done"}' },
        { args: ["bridge", "kanban", "remove"], stdin: '{"id":"T1"}' },
        { args: ["bridge", "config", "get"], stdin: "{}" },
        { args: ["bridge", "line", "add"], stdin: '{"agent":"mock"}' },
        { args: ["bridge", "line", "rm"], stdin: '{"agent":"mock"}' },
        { args: ["bridge", "line", "move"], stdin: '{"agent":"mock","position":1}' },
        { args: ["bridge", "events", "tail"], stdin: "{}" },
        { args: ["bridge", "discuss", "list"], stdin: '{"runId":"r1"}' },
        { args: ["bridge", "discuss", "thread"], stdin: '{"runId":"r1"}' },
        { args: ["bridge", "discuss", "answer"], stdin: '{"runId":"r1","qid":"q1","text":"ok"}' },
        { args: ["bridge", "discuss", "say"], stdin: '{"runId":"r1","text":"hi"}' },
        { args: ["bridge", "health", "get"], stdin: "{}" },
      ];
      for (const c of cases) {
        const r = runBridge(c.args, c.stdin, { AT_STATE_DIR: stateDir, AT_KANBAN_FILE: board });
        const out = JSON.parse(r.stdout);
        expect(typeof out).toBe("object");
        if (out.ok === true) {
          expect(out.data).toBeDefined();
        } else {
          expect(out.error).toBeDefined();
          expect(typeof out.error.code).toBe("string");
        }
      }
    } finally {
      rmSync(stateDir, { recursive: true, force: true });
    }
  });

  it("stdout is a single compact JSON line (no pretty-print, no banners)", () => {
    const stateDir = mkdtempSync(path.join(os.tmpdir(), "at-bridge-schema-line-"));
    seedStateDir(stateDir);
    try {
      const r = runBridge(["bridge", "ping", "ping"], "{}", { AT_STATE_DIR: stateDir });
      const lines = r.stdout.trim().split("\n");
      expect(lines.length).toBe(1);
      expect(lines[0]!.startsWith("{")).toBe(true);
      expect(r.stdout).not.toContain("[at]");
    } finally {
      rmSync(stateDir, { recursive: true, force: true });
    }
  });
});
