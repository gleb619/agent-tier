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
