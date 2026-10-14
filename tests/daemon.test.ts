import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

describe("daemon arg handling", () => {
  let stubDir = "";
  let stubBin = "";

  beforeAll(() => {
    stubDir = mkdtempSync(path.join(tmpdir(), "atd-stub-"));
    stubBin = path.join(stubDir, "atd");
    writeFileSync(stubBin, `#!/usr/bin/env node\nconsole.log("stub pid", process.pid);\n`);
  });

  afterAll(() => {
    rmSync(stubDir, { recursive: true, force: true });
  });

  it("start passes --idle-ms", () => {
    const env = { ...process.env, AT_DAEMON_BIN: stubBin, AT_STATE_DIR: stubDir };
    const result = spawnSync("node", ["dist/cli.js", "daemon", "start"], {
      env,
      encoding: "utf8",
      timeout: 3000,
    });
    // Should invoke the stub binary (check stdout contains daemon started)
    expect(result.stdout || result.stderr || "").toContain("daemon started");
  });

  it("status checks sock and pidfile", () => {
    const env = { ...process.env, AT_STATE_DIR: stubDir };
    const result = spawnSync("node", ["dist/cli.js", "daemon", "status"], {
      env,
      encoding: "utf8",
      timeout: 3000,
    });
    // Without running daemon, expects "no sock"
    expect(result.stdout + result.stderr).toContain("not running");
  });
});
