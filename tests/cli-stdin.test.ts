import { execSync, spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

const cliPath = path.join(__dirname, "..", "dist", "cli.js");

function buildCli(): void {
  execSync("npm run build", { stdio: "inherit" });
}

function runCli(
  args: string[],
  stdinData?: string,
  env?: NodeJS.ProcessEnv,
): { exitCode: number; stdout: string; stderr: string } {
  const result = spawnSync("node", [cliPath, ...args], {
    input: stdinData,
    encoding: "utf8",
    cwd: process.cwd(),
    env: env ?? process.env,
  });
  return {
    exitCode: result.status ?? -1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function waitForLogFile(logDir: string, agentName: string, timeoutMs = 5000): string | null {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const files = readdirSync(logDir).filter((f) => f.includes(`-${agentName}.log`));
    if (files.length > 0) {
      return path.join(logDir, files.sort().at(-1)!);
    }
    // sleep a bit before retrying
    const start = Date.now();
    while (Date.now() - start < 100) {
      /* spin */
    }
  }
  return null;
}

describe("stdin pipe mode", () => {
  beforeAll(() => {
    buildCli();
  }, 60000);

  it("reads prompt from piped stdin when no -p flag", async () => {
    const logDir = mkdtempSync(path.join(os.tmpdir(), "at-stdin-test-"));
    const result = runCli(["-a", "mock", "--log-dir", logDir], "hello from stdin");
    expect(result.exitCode).toBe(0);

    const logFile = waitForLogFile(logDir, "mock");
    expect(logFile).not.toBeNull();
    const content = readFileSync(logFile!, "utf8");
    expect(content).toContain("hello from stdin");
  });

  it("explicit -p flag takes precedence over stdin", async () => {
    const logDir = mkdtempSync(path.join(os.tmpdir(), "at-stdin-test-"));
    const result = runCli(["-a", "mock", "--log-dir", logDir, "-p", "explicit prompt"], "ignored");
    expect(result.exitCode).toBe(0);

    const logFile = waitForLogFile(logDir, "mock");
    expect(logFile).not.toBeNull();
    const content = readFileSync(logFile!, "utf8");
    expect(content).toContain("explicit prompt");
    expect(content).not.toContain("ignored");
  });

  it("no-arg invocation with piped stdin does NOT launch TUI", () => {
    const result = runCli(["-a", "mock", "-s"], "prompt");
    const output = result.stdout + result.stderr;
    expect(result.exitCode).toBe(0);
    expect(output).not.toContain("TUI requires Bun");
  });
});

describe("--json stdin mode", () => {
  beforeAll(() => {
    buildCli();
  }, 60000);

  it("reads JSON object from stdin and extracts prompt", async () => {
    const logDir = mkdtempSync(path.join(os.tmpdir(), "at-stdin-test-"));
    const result = runCli(["--json", "--log-dir", logDir], JSON.stringify({ prompt: "json prompt", agent: "mock" }));
    expect(result.exitCode).toBe(0);

    const logFile = waitForLogFile(logDir, "mock");
    expect(logFile).not.toBeNull();
    const content = readFileSync(logFile!, "utf8");
    expect(content).toContain("json prompt");
  });

  it("throws on invalid JSON", () => {
    const result = runCli(["--json"], "not json");
    expect(result.exitCode).not.toBe(0);
    expect(result.stdout + result.stderr).toContain("error");
  });

  it("throws when JSON missing prompt", () => {
    const result = runCli(["--json"], '{"agent":"mock"}');
    expect(result.exitCode).not.toBe(0);
    expect(result.stdout + result.stderr).toContain("error");
  });

  it("prepends globalPrompt from JSON to prompt", async () => {
    const logDir = mkdtempSync(path.join(os.tmpdir(), "at-stdin-test-"));
    const result = runCli(
      ["--json", "--log-dir", logDir],
      JSON.stringify({ prompt: "json prompt", agent: "mock", globalPrompt: "GLOBAL INSTRUCTIONS" }),
    );
    expect(result.exitCode).toBe(0);

    const logFile = waitForLogFile(logDir, "mock");
    expect(logFile).not.toBeNull();
    const content = readFileSync(logFile!, "utf8");
    expect(content).toContain("GLOBAL INSTRUCTIONS");
    expect(content).toContain("json prompt");
  });

  it("respects precedence: CLI --global-prompt > JSON globalPrompt > config globalPrompt", async () => {
    // Isolate HOME so the user's real ~/.at/config.json (which may define
    // globalPrompt) cannot leak into the "no globals" sub-case below.
    // LOCAL_BIN must keep pointing at the real bin dir — the mock agent
    // binary resolves to $LOCAL_BIN/mock-agent and would ENOENT otherwise.
    const isolatedHome = mkdtempSync(path.join(os.tmpdir(), "at-stdin-home-"));
    const isolatedEnv: NodeJS.ProcessEnv = {
      ...process.env,
      HOME: isolatedHome,
      LOCAL_BIN: path.join(os.homedir(), ".local", "bin"),
    };

    // Test 1: CLI --global-prompt takes precedence
    const logDir1 = mkdtempSync(path.join(os.tmpdir(), "at-stdin-test-1"));
    const result1 = runCli(
      ["--json", "--global-prompt", "CLI GLOBAL", "--log-dir", logDir1],
      JSON.stringify({ prompt: "json prompt", agent: "mock", globalPrompt: "JSON GLOBAL" }),
      isolatedEnv,
    );
    expect(result1.exitCode).toBe(0);
    const logFile1 = waitForLogFile(logDir1, "mock");
    expect(logFile1).not.toBeNull();
    const content1 = readFileSync(logFile1!, "utf8");
    expect(content1).toContain("CLI GLOBAL");
    expect(content1).toContain("json prompt");
    // Should NOT contain JSON global prompt due to precedence
    expect(content1).not.toContain("JSON GLOBAL");

    // Test 2: JSON globalPrompt when CLI not present
    const logDir2 = mkdtempSync(path.join(os.tmpdir(), "at-stdin-test-2"));
    const result2 = runCli(
      ["--json", "--log-dir", logDir2],
      JSON.stringify({ prompt: "json prompt", agent: "mock", globalPrompt: "JSON GLOBAL" }),
      isolatedEnv,
    );
    expect(result2.exitCode).toBe(0);
    const logFile2 = waitForLogFile(logDir2, "mock");
    expect(logFile2).not.toBeNull();
    const content2 = readFileSync(logFile2!, "utf8");
    expect(content2).toContain("JSON GLOBAL");
    expect(content2).toContain("json prompt");

    // Test 3: no globals at all (isolated HOME has no ~/.at/config.json,
    // so config globalPrompt cannot inject itself)
    const logDir3 = mkdtempSync(path.join(os.tmpdir(), "at-stdin-test-3"));
    const result3 = runCli(
      ["--json", "--log-dir", logDir3],
      JSON.stringify({ prompt: "json prompt", agent: "mock" }),
      isolatedEnv,
    );
    expect(result3.exitCode).toBe(0);
    const logFile3 = waitForLogFile(logDir3, "mock");
    expect(logFile3).not.toBeNull();
    const content3 = readFileSync(logFile3!, "utf8");
    expect(content3).toContain("json prompt");
    // Should not contain any global prompt additions
    expect(content3.split("\n\n").length).toBe(1); // No double newline separation
  });
});

describe("--callback flag", () => {
  beforeAll(() => {
    buildCli();
  }, 60000);

  it("runs callback after agent exits in stream mode", async () => {
    const markerFile = path.join(os.tmpdir(), `at-callback-cli-${Date.now()}.txt`);
    const result = runCli([
      "-a",
      "mock",
      "-s",
      "-p",
      "callback test",
      "--callback",
      `sh -c 'echo "status=$AT_STATUS agent=$AT_AGENT" > ${markerFile}'`,
    ]);
    expect(result.exitCode).toBe(0);
    const content = readFileSync(markerFile, "utf8").trim();
    expect(content).toContain("status=done");
    expect(content).toContain("agent=mock");
  });

  it("runs callback from JSON input", async () => {
    const markerFile = path.join(os.tmpdir(), `at-callback-json-${Date.now()}.txt`);
    const result = runCli(
      ["--json"],
      JSON.stringify({
        prompt: "json callback test",
        agent: "mock",
        callback: `sh -c 'echo "json-status=$AT_STATUS" > ${markerFile}'`,
      }),
    );
    expect(result.exitCode).toBe(0);
    await new Promise((resolve) => setTimeout(resolve, 500));
    const content = readFileSync(markerFile, "utf8").trim();
    expect(content).toContain("json-status=done");
  });
});
