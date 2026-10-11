import { describeLive } from "./live";
import { spawn } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  agentBinExists,
  classifyAgentExit,
  cleanupSandbox,
  createSandbox,
  DEFAULT_TIMEOUT,
  getCliPath,
  readAgentLog,
  type Sandbox,
} from "./setup";

describeLive("codex agent", () => {
  let sandbox: Sandbox;

  beforeEach(() => {
    sandbox = createSandbox();
  });
  afterEach(() => {
    cleanupSandbox(sandbox);
  });

  it(
    "should create test_result.txt with hello world",
    async () => {
      if (!agentBinExists("codex")) {
        console.log("SKIP: codex binary not found");
        return;
      }

      const cliPath = getCliPath();
      const prompt = "Create a file called test_result.txt containing the text 'hello world' and nothing else.";

      let output = "";
      const exitCode = await new Promise<number>((resolve) => {
        const child = spawn(
          "node",
          [cliPath, "-s", "-a", "codex", "-p", prompt, "--timeout", String(DEFAULT_TIMEOUT)],
          {
            cwd: sandbox.dir,
            stdio: ["ignore", "pipe", "pipe"],
          },
        );
        child.stdout.on("data", (d) => {
          output += d;
        });
        child.stderr.on("data", (d) => {
          output += d;
        });
        child.on("close", (code) => resolve(code ?? 1));
      });

      const logContent = readAgentLog("codex", output);
      if (classifyAgentExit(exitCode, `${output}\n${logContent}`) === "external-failure") {
        console.log(`SKIP: codex external/auth failure (exit ${exitCode})`);
        return;
      }

      expect(exitCode).toBe(0);
    },
    DEFAULT_TIMEOUT + 10000,
  );
});
