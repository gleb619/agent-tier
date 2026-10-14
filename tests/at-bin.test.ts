/**
 * T32: smoke suite for the standalone `bin/at` binary produced by
 * scripts/build-at-bin.sh (bun build --compile).
 *
 * Skipped when the binary is not built — the default unit suite must not pay
 * the compile cost. `pnpm run build:bin` builds the binary and then runs this
 * file as its smoke gate.
 *
 * Sandbox: every invocation runs with a throwaway AT_STATE_DIR and MOCK_BIN
 * pointed at the repo's mock agent, so no real agents or shared state touched.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "..");
const binAt = path.join(root, "bin", "at");

const stateDir = mkdtempSync(path.join(os.tmpdir(), "at-bin-smoke-"));

function runAt(args: string[]): { exitCode: number; stdout: string; stderr: string } {
  // Drop AT_DEPTH/AT_ALLOW_NESTED: when the suite itself runs under an `at`
  // agent, the nesting guard would refuse every child invocation.
  const { AT_DEPTH: _d, AT_ALLOW_NESTED: _n, ...env } = process.env;
  const result = spawnSync(binAt, args, {
    encoding: "utf8",
    cwd: root,
    timeout: 120000,
    env: {
      ...env,
      AT_STATE_DIR: stateDir,
      MOCK_BIN: path.join(root, "bin", "mock-agent"),
      MOCK_LONG_BIN: path.join(root, "bin", "mock-long-agent"),
    },
  });
  return { exitCode: result.status ?? -1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

afterAll(() => {
  rmSync(stateDir, { recursive: true, force: true });
});

describe.skipIf(!existsSync(binAt))("bin/at — standalone binary smoke (T32)", () => {
  it("is executable and reports its version", () => {
    const r = runAt(["--version"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout.trim()).not.toBe("");
  });

  it("agents list works from the sandbox state dir", () => {
    const r = runAt(["agents", "list"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("mock");
  });

  it("runs a blocking mock-tier prompt end to end", () => {
    const r = runAt(["-t", "4", "-s", "-p", "say hi"]);
    expect(r.exitCode).toBe(0);
  });

  it("kanban list reads the board", () => {
    const r = runAt(["kanban", "list"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("T32");
  });
});
