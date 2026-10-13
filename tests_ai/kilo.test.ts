import { spawn } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { describeLive } from "./live";
import {
  agentBinExists,
  cleanupSandbox,
  createSandbox,
  DEFAULT_TIMEOUT,
  getCliPath,
  isAgentEnabled,
  type Sandbox,
} from "./setup";

describeLive("kilo agent", () => {
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
      if (!agentBinExists("kilo")) {
        console.log("SKIP: kilo binary not found");
        return;
      }
      if (!isAgentEnabled("kilo")) {
        console.log("SKIP: kilo is deactivated or temporarily disabled");
        return;
      }

      const cliPath = getCliPath();
      const prompt = "Create a file called test_result.txt containing the text 'hello world' and nothing else.";

      const exitCode = await new Promise<number>((resolve) => {
        const child = spawn("node", [cliPath, "-s", "-a", "kilo", "-p", prompt, "--timeout", String(DEFAULT_TIMEOUT)], {
          cwd: sandbox.dir,
          stdio: "inherit",
        });
        child.on("close", (code) => resolve(code ?? 1));
      });

      expect(exitCode).toBe(0);
    },
    DEFAULT_TIMEOUT + 10000,
  );
});
