/**
 * T26: `at bridge <resource> <verb>` — JSON-in (stdin) / JSON-out (stdout) RPC surface.
 * Contract: docs/bridge.md
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

describe("at bridge — core dispatcher (T26)", () => {
  beforeAll(() => {
    buildCli();
  }, 120000);

  it("bridge ping ping → ok envelope with version", () => {
    const stateDir = mkdtempSync(path.join(os.tmpdir(), "at-bridge-ping-"));
    seedStateDir(stateDir);
    try {
      const r = runBridge(["bridge", "ping", "ping"], "{}", { AT_STATE_DIR: stateDir });
      expect(r.exitCode).toBe(0);
      const out = JSON.parse(r.stdout);
      expect(out.ok).toBe(true);
      expect(typeof out.data.version).toBe("string");
      expect(out.data.version.length).toBeGreaterThan(0);
    } finally {
      rmSync(stateDir, { recursive: true, force: true });
    }
  });

  it("empty stdin is treated as empty params", () => {
    const stateDir = mkdtempSync(path.join(os.tmpdir(), "at-bridge-empty-"));
    seedStateDir(stateDir);
    try {
      const r = runBridge(["bridge", "ping", "ping"], "", { AT_STATE_DIR: stateDir });
      expect(r.exitCode).toBe(0);
      expect(JSON.parse(r.stdout).ok).toBe(true);
    } finally {
      rmSync(stateDir, { recursive: true, force: true });
    }
  });

  it("bridge agents list → same shape as at agents --json", () => {
    const stateDir = mkdtempSync(path.join(os.tmpdir(), "at-bridge-agents-"));
    seedStateDir(stateDir);
    try {
      const r = runBridge(["bridge", "agents", "list"], "{}", { AT_STATE_DIR: stateDir });
      expect(r.exitCode).toBe(0);
      const out = JSON.parse(r.stdout);
      expect(out.ok).toBe(true);
      expect(Array.isArray(out.data)).toBe(true);
      expect(out.data.length).toBeGreaterThan(0);
      for (const entry of out.data as Array<Record<string, unknown>>) {
        expect(typeof entry.name).toBe("string");
        expect(typeof entry.tier).toBe("number");
      }
    } finally {
      rmSync(stateDir, { recursive: true, force: true });
    }
  });

  it("unknown resource → exit 2 with error envelope", () => {
    const stateDir = mkdtempSync(path.join(os.tmpdir(), "at-bridge-badres-"));
    seedStateDir(stateDir);
    try {
      const r = runBridge(["bridge", "bogus", "ping"], "{}", { AT_STATE_DIR: stateDir });
      expect(r.exitCode).toBe(2);
      const out = JSON.parse(r.stdout);
      expect(out.ok).toBeUndefined();
      expect(out.error.code).toBe("UNKNOWN_RESOURCE");
      expect(typeof out.error.message).toBe("string");
    } finally {
      rmSync(stateDir, { recursive: true, force: true });
    }
  });

  it("unknown verb → exit 2 with error envelope", () => {
    const stateDir = mkdtempSync(path.join(os.tmpdir(), "at-bridge-badverb-"));
    seedStateDir(stateDir);
    try {
      const r = runBridge(["bridge", "ping", "bogus"], "{}", { AT_STATE_DIR: stateDir });
      expect(r.exitCode).toBe(2);
      const out = JSON.parse(r.stdout);
      expect(out.error.code).toBe("UNKNOWN_VERB");
    } finally {
      rmSync(stateDir, { recursive: true, force: true });
    }
  });

  it("invalid JSON stdin → exit 2 with BAD_JSON", () => {
    const stateDir = mkdtempSync(path.join(os.tmpdir(), "at-bridge-badjson-"));
    seedStateDir(stateDir);
    try {
      const r = runBridge(["bridge", "ping", "ping"], "not-json{{{", { AT_STATE_DIR: stateDir });
      expect(r.exitCode).toBe(2);
      const out = JSON.parse(r.stdout);
      expect(out.error.code).toBe("BAD_JSON");
    } finally {
      rmSync(stateDir, { recursive: true, force: true });
    }
  });

  it("stdout is a single JSON line — no banners, no logs", () => {
    const stateDir = mkdtempSync(path.join(os.tmpdir(), "at-bridge-clean-"));
    seedStateDir(stateDir);
    try {
      const r = runBridge(["bridge", "ping", "ping"], "{}", { AT_STATE_DIR: stateDir });
      expect(r.exitCode).toBe(0);
      const lines = r.stdout.trim().split("\n");
      expect(lines.length).toBe(1);
      expect(lines[0].startsWith("{")).toBe(true);
      expect(r.stdout).not.toContain("[at]");
    } finally {
      rmSync(stateDir, { recursive: true, force: true });
    }
  });
});
