import { spawn } from "node:child_process";
import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { agentBinExists, cleanupSandbox, createSandbox, getCliPath, type Sandbox } from "./setup";

describe("mock-long agent", () => {
  let sandbox: Sandbox;

  beforeEach(() => {
    sandbox = createSandbox();
  });
  afterEach(() => {
    cleanupSandbox(sandbox);
  });

  it("should stream output for 30 seconds and produce output files", async () => {
    if (!agentBinExists("mock-long")) {
      console.log("SKIP: mock-long binary not found");
      return;
    }

    const cliPath = getCliPath();
    const prompt = "Write files demonstrating long-running work with streaming output";

    const exitCode = await new Promise<number>((resolve) => {
      const child = spawn("node", [cliPath, "-s", "-a", "mock-long", "-p", prompt, "--timeout", "40000"], {
        cwd: sandbox.dir,
        stdio: "inherit",
      });
      child.on("close", (code) => resolve(code ?? 1));
    });

    expect(exitCode).toBe(0);

    // Verify output files were created
    const files = fs.readdirSync(sandbox.dir);
    const stepFiles = files.filter((f) => f.startsWith("step-") && f.endsWith(".txt"));
    expect(stepFiles.length).toBeGreaterThan(0);
  }, 60000);

  it("should respect MOCK_LONG_DURATION env var", async () => {
    if (!agentBinExists("mock-long")) {
      console.log("SKIP: mock-long binary not found");
      return;
    }

    const cliPath = getCliPath();
    const prompt = "Quick test with 3 second duration";

    const start = Date.now();
    const exitCode = await new Promise<number>((resolve) => {
      const child = spawn("node", [cliPath, "-s", "-a", "mock-long", "-p", prompt, "--timeout", "15000"], {
        cwd: sandbox.dir,
        stdio: "inherit",
        env: { ...process.env, MOCK_LONG_DURATION: "3000" },
      });
      child.on("close", (code) => resolve(code ?? 1));
    });
    const elapsed = Date.now() - start;

    expect(exitCode).toBe(0);
    expect(elapsed).toBeGreaterThan(2500);
    expect(elapsed).toBeLessThan(10000);
  }, 30000);
});
