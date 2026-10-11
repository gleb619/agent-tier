import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmdirSync, rmSync, unlinkSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Mock } from "vitest";
import type { AgentDef } from "../src/agents/registry";
import * as health from "../src/health";
import type { RunOptions } from "../src/resolver";
import { spawnRunWatch } from "../src/run-watch";
import { AgentError, defaultSpawner, run, type Spawner } from "../src/runner";
import * as scheduler from "../src/scheduler";

vi.mock("../src/scheduler");
vi.mock("../src/health");
vi.mock("../src/run-watch");
vi.mock("../src/sandbox", () => ({
  runSandboxTest: vi.fn(() => Promise.resolve()),
}));
vi.mock("../src/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/config")>();
  return {
    ...actual,
    loadConfig: vi.fn(() => null),
  };
});
vi.mock("../src/namer", () => ({
  generateSessionName: vi.fn(() => Promise.resolve({ name: "test-name", provider: "mock" as string | null })),
}));
vi.mock("child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("child_process")>();
  const { EventEmitter } = await import("node:events");
  return {
    ...actual,
    spawn: vi.fn((...args: any[]) => {
      const cmd = args[0];
      if (cmd === "/nonexistent-binary-12345") {
        const child = new EventEmitter() as any;
        child.pid = undefined;
        child.stdin = null;
        child.stdout = null;
        child.stderr = null;
        return child;
      }
      return (actual.spawn as any)(...args);
    }),
  };
});

function makeAgent(name: string): AgentDef {
  return { name, tier: 2, bin: () => "/usr/bin/true", buildArgs: (p) => [p] };
}

const defaultStateDir = process.env.AT_STATE_DIR ?? path.join(os.homedir(), ".at");

const baseOptions: RunOptions = {
  agent: "auto",
  tier: 2,
  prompt: "hello",
  stream: true,
  stateDir: defaultStateDir,
  retries: 0,
  logDir: "/tmp/at-logs",
  noChop: false,
  timeout: 3600000,
  sse: false,
  ssePort: 0,
};

const agents = [makeAgent("a"), makeAgent("b"), makeAgent("c")];

beforeEach(() => {
  vi.resetAllMocks();
  let callCount = 0;
  (scheduler.pickAgent as Mock).mockImplementation((candidates: AgentDef[]) => {
    return candidates[callCount++ % candidates.length];
  });
  (scheduler.getStateFile as Mock).mockReturnValue(path.join(defaultStateDir, "state.json"));
  (health.filterHealthy as Mock).mockImplementation((_stateFile: string, agents: AgentDef[]) => agents);
  (health.recordResult as Mock).mockImplementation(() => Promise.resolve());
  (health.isDeactivated as Mock).mockReturnValue(false);
});

describe("run — auto mode", () => {
  it("resolves on first success", async () => {
    const spawner: Spawner = vi.fn().mockResolvedValue(0);
    await run(baseOptions, agents, spawner);
    expect(spawner).toHaveBeenCalledTimes(1);
  });

  it("does not retry when retries is 0", async () => {
    const spawner: Spawner = vi.fn().mockResolvedValue(1);
    await expect(run({ ...baseOptions, retries: 0 }, agents, spawner)).rejects.toThrow();
    expect(spawner).toHaveBeenCalledTimes(1);
  });

  it("retries up to retries count when retries option is set", async () => {
    const spawner: Spawner = vi.fn().mockResolvedValue(1);
    await expect(run({ ...baseOptions, retries: 2 }, agents, spawner)).rejects.toThrow();
    // 1 initial + 2 retries = 3, but pool is 3 so max attempts = 1 + min(2, 2) = 3
    expect(spawner).toHaveBeenCalledTimes(3);
  });

  it("caps retries at pool size minus one", async () => {
    const spawner: Spawner = vi.fn().mockResolvedValue(1);
    await expect(run({ ...baseOptions, retries: 10 }, agents, spawner)).rejects.toThrow();
    // pool has 3 agents, so max attempts = 1 + min(10, 2) = 3
    expect(spawner).toHaveBeenCalledTimes(3);
  });

  it("succeeds on retry after initial failure", async () => {
    const spawner: Spawner = vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(0);
    const exitCode = await run({ ...baseOptions, retries: 2 }, agents, spawner);
    expect(exitCode).toBe(0);
    expect(spawner).toHaveBeenCalledTimes(2);
  });

  it("throws after all agents fail", async () => {
    const spawner: Spawner = vi.fn().mockResolvedValue(1);
    await expect(run(baseOptions, agents, spawner)).rejects.toThrow();
  });

  it("throws when tier has no agents", async () => {
    const spawner: Spawner = vi.fn();
    await expect(run({ ...baseOptions, tier: 1 }, [], spawner)).rejects.toThrow("No agents");
  });
});

describe("run — named agent mode", () => {
  it("uses the named agent without calling scheduler", async () => {
    const spawner: Spawner = vi.fn().mockResolvedValue(0);
    await run({ ...baseOptions, agent: "a" }, agents, spawner);
    const calledAgent = (spawner as Mock).mock.calls[0][0] as AgentDef;
    expect(calledAgent.name).toBe("a");
    expect(scheduler.pickAgent).not.toHaveBeenCalled();
  });

  it("throws for unknown named agent", async () => {
    const spawner: Spawner = vi.fn();
    await expect(run({ ...baseOptions, agent: "unknown" }, agents, spawner)).rejects.toThrow("Unknown agent");
  });

  it("throws for deactivated agent", async () => {
    (health.isDeactivated as Mock).mockReturnValue(true);
    const spawner: Spawner = vi.fn();
    await expect(run({ ...baseOptions, agent: "a" }, agents, spawner)).rejects.toThrow("deactivated");
  });

  it("does not retry named agent on failure", async () => {
    const spawner: Spawner = vi.fn().mockResolvedValue(1);
    await expect(run({ ...baseOptions, agent: "a" }, agents, spawner)).rejects.toThrow();
    expect(spawner).toHaveBeenCalledTimes(1);
  });
});

describe("run — detached mode", () => {
  it("uses the spawner in detached mode", async () => {
    const spawner: Spawner = vi.fn().mockResolvedValue(0);
    await run({ ...baseOptions, stream: false }, agents, spawner);
    expect(spawner).toHaveBeenCalledTimes(1);
  });
});

describe("defaultSpawner", () => {
  const tmpLogDir = "/tmp/at-test-logs-runner";

  beforeEach(() => {
    if (existsSync(tmpLogDir)) {
      for (const f of readdirSync(tmpLogDir)) {
        unlinkSync(path.join(tmpLogDir, f));
      }
      rmdirSync(tmpLogDir);
    }
  });

  it("creates a non-empty log file in stream mode", async () => {
    const agent: AgentDef = {
      name: "test",
      tier: 2,
      bin: () => "/bin/echo",
      buildArgs: (p) => [p],
    };
    const options: RunOptions = {
      ...baseOptions,
      stream: true,
      logDir: tmpLogDir,
      prompt: "hello",
    };
    const exitCode = await defaultSpawner(agent, options);
    expect(exitCode).toBe(0);
    const files = readdirSync(tmpLogDir);
    expect(files.length).toBe(1);
    const logPath = path.join(tmpLogDir, files[0]);
    const content = readFileSync(logPath, "utf8");
    expect(content.length).toBeGreaterThan(0);
    expect(content).toContain("hello");
  });

  it("creates a log file with runId header and agent output in detached mode", async () => {
    const agent: AgentDef = {
      name: "test",
      tier: 2,
      bin: () => "/bin/echo",
      buildArgs: (p) => [p],
    };
    const options: RunOptions = {
      ...baseOptions,
      stream: false,
      logDir: tmpLogDir,
      prompt: "hello",
    };
    const exitCode = await defaultSpawner(agent, options);
    expect(exitCode).toBe(0);
    // Fire-and-forget: wait briefly for agent output to flush
    await new Promise((resolve) => setTimeout(resolve, 200));
    const files = readdirSync(tmpLogDir);
    expect(files.length).toBe(1);
    const logPath = path.join(tmpLogDir, files[0]);
    const content = readFileSync(logPath, "utf8");
    expect(content).toContain("runId:");
    expect(content).toContain("hello");
  });

  it("writes spawn error to log file in stream mode", async () => {
    const agent: AgentDef = {
      name: "test",
      tier: 2,
      bin: () => "/nonexistent-binary-12345",
      buildArgs: (p) => [p],
    };
    const options: RunOptions = {
      ...baseOptions,
      stream: true,
      noChop: true,
      logDir: tmpLogDir,
      prompt: "hello",
    };
    await expect(defaultSpawner(agent, options)).rejects.toThrow("no PID assigned");
    const files = readdirSync(tmpLogDir);
    expect(files.length).toBe(1);
    const logPath = path.join(tmpLogDir, files[0]);
    const content = readFileSync(logPath, "utf8");
    expect(content.length).toBeGreaterThan(0);
    expect(content).toContain("Failed to spawn");
  });

  it("writes spawn error to log file in detached mode", async () => {
    const agent: AgentDef = {
      name: "test",
      tier: 2,
      bin: () => "/nonexistent-binary-12345",
      buildArgs: (p) => [p],
    };
    const options: RunOptions = {
      ...baseOptions,
      stream: false,
      logDir: tmpLogDir,
      prompt: "hello",
    };
    await expect(defaultSpawner(agent, options)).rejects.toThrow("no PID assigned");
    const files = readdirSync(tmpLogDir);
    expect(files.length).toBe(1);
    const logPath = path.join(tmpLogDir, files[0]);
    const content = readFileSync(logPath, "utf8");
    expect(content.length).toBeGreaterThan(0);
    expect(content).toContain("Failed to spawn");
  });

  it("executes callback in stream mode with context env vars", async () => {
    const markerFile = path.join(tmpLogDir, "callback-marker-stream.txt");
    const agent: AgentDef = {
      name: "test",
      tier: 2,
      bin: () => "/bin/echo",
      buildArgs: (p) => [p],
    };
    const options: RunOptions = {
      ...baseOptions,
      stream: true,
      noChop: true,
      logDir: tmpLogDir,
      prompt: "hello",
      callback: `sh -c 'echo "agent=$AT_AGENT status=$AT_STATUS exit=$AT_EXIT_CODE tier=$AT_TIER" > ${markerFile}'`,
    };
    const exitCode = await defaultSpawner(agent, options);
    expect(exitCode).toBe(0);
    const content = readFileSync(markerFile, "utf8").trim();
    expect(content).toContain("agent=test");
    expect(content).toContain("status=done");
    expect(content).toContain("exit=0");
    expect(content).toContain("tier=2");
  });

  it("executes callback on failure with failed status", async () => {
    const markerFile = path.join(tmpLogDir, "callback-marker-fail.txt");
    const agent: AgentDef = {
      name: "test",
      tier: 2,
      bin: () => "/bin/bash",
      buildArgs: () => ["-c", "exit 7"],
    };
    const options: RunOptions = {
      ...baseOptions,
      stream: true,
      noChop: true,
      logDir: tmpLogDir,
      prompt: "hello",
      callback: `sh -c 'echo "status=$AT_STATUS exit=$AT_EXIT_CODE" > ${markerFile}'`,
    };
    const exitCode = await defaultSpawner(agent, options);
    expect(exitCode).toBe(7);
    const content = readFileSync(markerFile, "utf8").trim();
    expect(content).toContain("status=failed");
    expect(content).toContain("exit=7");
  });

  it("detached without --wait returns immediately and spawns the supervisor", async () => {
    const agent: AgentDef = {
      name: "test",
      tier: 2,
      bin: () => "/bin/sleep",
      buildArgs: () => ["30"],
    };
    const options: RunOptions = {
      ...baseOptions,
      stream: false,
      logDir: tmpLogDir,
      prompt: "hello",
    };
    const start = Date.now();
    const exitCode = await defaultSpawner(agent, options);
    expect(exitCode).toBe(0);
    expect(Date.now() - start).toBeLessThan(5000);
    expect(spawnRunWatch).toHaveBeenCalledTimes(1);
    expect(spawnRunWatch).toHaveBeenCalledWith(
      expect.objectContaining({
        pid: expect.any(Number),
        runId: expect.any(String),
        stateDir: options.stateDir,
        agent: "test",
        tier: 2,
        logFile: expect.any(String),
        prompt: "hello",
      }),
    );
    // Clean up the detached sleep child (mocked supervisor would have done this)
    const pid = (spawnRunWatch as Mock).mock.calls[0][0].pid as number;
    try {
      process.kill(-pid, "SIGKILL");
    } catch {}
  });

  it("detached with --wait blocks until exit and returns the real exit code", async () => {
    const agent: AgentDef = {
      name: "test",
      tier: 2,
      bin: () => "/bin/bash",
      buildArgs: () => ["-c", "exit 7"],
    };
    const options: RunOptions = {
      ...baseOptions,
      stream: false,
      wait: true,
      logDir: tmpLogDir,
      prompt: "hello",
    };
    const exitCode = await defaultSpawner(agent, options);
    expect(exitCode).toBe(7);
    expect(spawnRunWatch).not.toHaveBeenCalled();
  });

  it("does not fail main run when callback exits non-zero", async () => {
    const agent: AgentDef = {
      name: "test",
      tier: 2,
      bin: () => "/bin/echo",
      buildArgs: (p) => [p],
    };
    const options: RunOptions = {
      ...baseOptions,
      stream: true,
      noChop: true,
      logDir: tmpLogDir,
      prompt: "hello",
      callback: "exit 42",
    };
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const exitCode = await defaultSpawner(agent, options);
    expect(exitCode).toBe(0);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("callback exited with code 42"));
    warnSpy.mockRestore();
  });

  it("executes callback in detached --wait mode after child exits", async () => {
    const markerFile = path.join(tmpLogDir, "callback-marker-detached.txt");
    const agent: AgentDef = {
      name: "test",
      tier: 2,
      bin: () => "/bin/echo",
      buildArgs: (p) => [p],
    };
    const options: RunOptions = {
      ...baseOptions,
      stream: false,
      wait: true,
      logDir: tmpLogDir,
      prompt: "hello",
      callback: `sh -c 'echo "agent=$AT_AGENT status=$AT_STATUS" > ${markerFile}'`,
    };
    const exitCode = await defaultSpawner(agent, options);
    expect(exitCode).toBe(0);
    // Fire-and-forget: wait briefly for the close event and callback to fire
    await new Promise((resolve) => setTimeout(resolve, 300));
    const content = readFileSync(markerFile, "utf8").trim();
    expect(content).toContain("agent=test");
    expect(content).toContain("status=done");
  });
});

describe("defaultSpawner — --verify hook", () => {
  const tmpLogDir = "/tmp/at-test-logs-runner-verify";

  beforeEach(() => {
    if (existsSync(tmpLogDir)) {
      for (const f of readdirSync(tmpLogDir)) {
        try {
          unlinkSync(path.join(tmpLogDir, f));
        } catch {}
      }
      try {
        rmdirSync(tmpLogDir);
      } catch {}
    }
  });

  it("passes the run through when --verify exits 0 (stream mode)", async () => {
    const agent: AgentDef = {
      name: "test",
      tier: 2,
      bin: () => "/bin/echo",
      buildArgs: (p) => [p],
    };
    const options: RunOptions = {
      ...baseOptions,
      stream: true,
      noChop: true,
      logDir: tmpLogDir,
      prompt: "hello",
      verify: "true",
    };
    const exitCode = await defaultSpawner(agent, options);
    expect(exitCode).toBe(0);
    await new Promise((resolve) => setTimeout(resolve, 100));
    const logPath = path.join(tmpLogDir, readdirSync(tmpLogDir)[0]);
    const content = readFileSync(logPath, "utf8");
    expect(content).toContain("[at] verify ok: true");
    expect(content).not.toContain("verify failed");
  });

  it("fails the run (AgentError) when --verify exits non-zero (stream mode)", async () => {
    const agent: AgentDef = {
      name: "test",
      tier: 2,
      bin: () => "/bin/echo",
      buildArgs: (p) => [p],
    };
    const options: RunOptions = {
      ...baseOptions,
      stream: true,
      noChop: true,
      logDir: tmpLogDir,
      prompt: "hello",
      verify: 'sh -c "echo boom; exit 3"',
    };
    await expect(defaultSpawner(agent, options)).rejects.toThrow(/verify failed/);
    await new Promise((resolve) => setTimeout(resolve, 100));
    const logPath = path.join(tmpLogDir, readdirSync(tmpLogDir)[0]);
    const content = readFileSync(logPath, "utf8");
    expect(content).toContain('[at] verify failed (exit 3): sh -c "echo boom; exit 3"');
    expect(content).toContain("boom");
  });

  it("fails the run (AgentError) when --verify exits non-zero (--wait mode)", async () => {
    const agent: AgentDef = {
      name: "test",
      tier: 2,
      bin: () => "/bin/echo",
      buildArgs: (p) => [p],
    };
    const options: RunOptions = {
      ...baseOptions,
      stream: false,
      wait: true,
      logDir: tmpLogDir,
      prompt: "hello",
      verify: "exit 9",
    };
    await expect(defaultSpawner(agent, options)).rejects.toThrow(/verify failed/);
    const logPath = path.join(tmpLogDir, readdirSync(tmpLogDir)[0]);
    const content = readFileSync(logPath, "utf8");
    expect(content).toContain("[at] verify failed (exit 9): exit 9");
  });

  it("still fires --callback with AT_STATUS=failed when verify fails", async () => {
    const markerFile = path.join(tmpLogDir, "callback-marker-verify-fail.txt");
    const agent: AgentDef = {
      name: "test",
      tier: 2,
      bin: () => "/bin/echo",
      buildArgs: (p) => [p],
    };
    const options: RunOptions = {
      ...baseOptions,
      stream: true,
      noChop: true,
      logDir: tmpLogDir,
      prompt: "hello",
      verify: "exit 2",
      callback: `sh -c 'echo "status=$AT_STATUS" > ${markerFile}'`,
    };
    await expect(defaultSpawner(agent, options)).rejects.toThrow(/verify failed/);
    const content = readFileSync(markerFile, "utf8").trim();
    expect(content).toContain("status=failed");
  });

  it("triggers retry-with-next-agent when verify fails (auto mode, retries=2)", async () => {
    // Direct unit-level proof: a mock spawner that throws AgentError must
    // make run() retry the next candidate. The real subprocess path is
    // covered above; here we assert the retry contract end-to-end.
    const spawner: Spawner = vi
      .fn()
      .mockImplementationOnce(() => Promise.reject(new AgentError("verify failed (exit 1)", 1)))
      .mockResolvedValueOnce(0);
    const exitCode = await run({ ...baseOptions, retries: 2 }, agents, spawner);
    expect(exitCode).toBe(0);
    expect(spawner).toHaveBeenCalledTimes(2);
  });

  it("forwards AT_VERIFY_CMD + AT_CWD env to the detached supervisor (not argv)", async () => {
    // The supervisor spawn must run inside an existing cwd or spawn ENOENTs.
    const fakeCwd = path.join(tmpLogDir, "fake-cwd");
    mkdirSync(fakeCwd, { recursive: true });
    const agent: AgentDef = {
      name: "test",
      tier: 2,
      bin: () => "/bin/bash",
      buildArgs: () => ["-c", "sleep 0.2"],
    };
    const options: RunOptions = {
      ...baseOptions,
      stream: false,
      logDir: tmpLogDir,
      prompt: "hello",
      verify: "echo verify-stamp",
      cwd: fakeCwd,
    };
    const exitCode = await defaultSpawner(agent, options);
    expect(exitCode).toBe(0);
    expect(spawnRunWatch).toHaveBeenCalledWith(
      expect.objectContaining({
        verify: "echo verify-stamp",
        cwd: fakeCwd,
      }),
    );
    const pid = (spawnRunWatch as Mock).mock.calls[0][0].pid as number;
    try {
      process.kill(-pid, "SIGKILL");
    } catch {}
  });
});

describe("run — namer integration (always-on)", () => {
  it("calls namer by default (fire-and-forget)", async () => {
    const { generateSessionName } = await import("../src/namer");
    (generateSessionName as Mock).mockResolvedValue({
      name: "refactor-auth-middleware-please",
      provider: "local-ollama",
    });
    const spawner: Spawner = vi.fn().mockResolvedValue(0);
    await run({ ...baseOptions, prompt: "refactor auth" }, agents, spawner);
    expect(generateSessionName).toHaveBeenCalledTimes(1);
  });

  it("spawner receives undefined runName (namer is fire-and-forget, lands via updateRun)", async () => {
    const { generateSessionName } = await import("../src/namer");
    (generateSessionName as Mock).mockResolvedValue({
      name: "refactor-auth-middleware-please",
      provider: "local-ollama",
    });
    const spawner: Spawner = vi.fn(async (_agent, opts) => {
      expect((opts as RunOptions).runName).toBeUndefined();
      return 0;
    });
    await run({ ...baseOptions }, agents, spawner);
    expect(spawner).toHaveBeenCalledTimes(1);
  });
});

describe("defaultSpawner — namer name propagation", () => {
  const tmpLogDir = "/tmp/at-test-logs-runner-namer";

  beforeEach(() => {
    if (existsSync(tmpLogDir)) {
      for (const f of readdirSync(tmpLogDir)) {
        unlinkSync(path.join(tmpLogDir, f));
      }
      rmdirSync(tmpLogDir);
    }
  });

  it("writes AT_RUN_NAME env from options.runName into child process", async () => {
    const envCapture = path.join(tmpLogDir, "env.txt");
    const agent: AgentDef = {
      name: "env-capture",
      tier: 2,
      bin: () => "/bin/sh",
      buildArgs: () => ["-c", `echo "$AT_RUN_NAME" > ${envCapture}`],
    };
    const options: RunOptions = {
      ...baseOptions,
      stream: true,
      noChop: true,
      logDir: tmpLogDir,
      prompt: "hello",
      runName: "add-error-handling-to-api",
    };
    const exitCode = await defaultSpawner(agent, options);
    expect(exitCode).toBe(0);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(readFileSync(envCapture, "utf8").trim()).toBe("add-error-handling-to-api");
  });

  it('uses "unnamed" when options.runName is missing', async () => {
    const envCapture = path.join(tmpLogDir, "env.txt");
    const agent: AgentDef = {
      name: "env-capture-unnamed",
      tier: 2,
      bin: () => "/bin/sh",
      buildArgs: () => ["-c", `echo "$AT_RUN_NAME" > ${envCapture}`],
    };
    const options: RunOptions = {
      ...baseOptions,
      stream: true,
      noChop: true,
      logDir: tmpLogDir,
      prompt: "hello",
    };
    const exitCode = await defaultSpawner(agent, options);
    expect(exitCode).toBe(0);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(readFileSync(envCapture, "utf8").trim()).toBe("unnamed");
  });
});

describe("run — line mode (tier undefined)", () => {
  // Mixed-tier agents to prove line mode is NOT just one tier.
  const lineAgents: AgentDef[] = [
    { name: "a-tier1", tier: 1, bin: () => "/bin/true", buildArgs: (p) => [p] },
    { name: "b-tier2", tier: 2, bin: () => "/bin/true", buildArgs: (p) => [p] },
    { name: "c-tier3", tier: 3, bin: () => "/bin/true", buildArgs: (p) => [p] },
    { name: "d-mock", tier: 4, bin: () => "/bin/true", buildArgs: (p) => [p] },
  ];

  it("picks first candidate from line pool (tier 3 first by default)", async () => {
    const spawner: Spawner = vi.fn().mockResolvedValue(0);
    const opts: RunOptions = { ...baseOptions };
    delete (opts as { tier?: number }).tier;
    await run(opts, lineAgents, spawner);
    const calledAgent = (spawner as Mock).mock.calls[0][0] as AgentDef;
    // Default order excludes tier 4; tier 3 comes first.
    expect(calledAgent.name).toBe("c-tier3");
  });

  it('uses scheduler key "line" (not "tier-N") for pickAgent', async () => {
    const spawner: Spawner = vi.fn().mockResolvedValue(0);
    const opts: RunOptions = { ...baseOptions };
    delete (opts as { tier?: number }).tier;
    await run(opts, lineAgents, spawner);
    expect(scheduler.pickAgent).toHaveBeenCalledWith(expect.any(Array), expect.any(String), "line");
  });

  it("retries pick next line agent on failure", async () => {
    const spawner: Spawner = vi.fn().mockResolvedValue(1);
    const opts: RunOptions = { ...baseOptions, retries: 3 };
    delete (opts as { tier?: number }).tier;
    await expect(run(opts, lineAgents, spawner)).rejects.toThrow();
    // 1 + min(3, 3) = 4 — but d-mock (tier 4) is excluded from line pool, so 3 candidates.
    expect(spawner).toHaveBeenCalledTimes(3);
  });

  it("throws when no non-tier-4 agents exist (line pool is empty)", async () => {
    const spawner: Spawner = vi.fn();
    const onlyMocks: AgentDef[] = [{ name: "mock1", tier: 4, bin: () => "/bin/true", buildArgs: (p) => [p] }];
    const opts: RunOptions = { ...baseOptions };
    delete (opts as { tier?: number }).tier;
    await expect(run(opts, onlyMocks, spawner)).rejects.toThrow(/line/);
  });

  it("does not call runSandboxTest when sandbox option is not set", async () => {
    const { runSandboxTest } = await import("../src/sandbox");
    const spawner: Spawner = vi.fn().mockResolvedValue(0);
    const opts: RunOptions = { ...baseOptions };
    delete (opts as { tier?: number }).tier;
    await run(opts, lineAgents, spawner);
    expect(runSandboxTest).not.toHaveBeenCalled();
  });

  it("triggers runSandboxTest when sandbox: true", async () => {
    const { runSandboxTest } = await import("../src/sandbox");
    (runSandboxTest as Mock).mockClear();
    const spawner: Spawner = vi.fn().mockResolvedValue(0);
    const opts: RunOptions = { ...baseOptions, sandbox: true };
    delete (opts as { tier?: number }).tier;
    await run(opts, lineAgents, spawner);
    expect(runSandboxTest).toHaveBeenCalledTimes(1);
    expect(runSandboxTest).toHaveBeenCalledWith("c-tier3");
  });

  it("retries next line agent when runSandboxTest throws", async () => {
    const { runSandboxTest } = await import("../src/sandbox");
    (runSandboxTest as Mock).mockClear();
    (runSandboxTest as Mock)
      .mockImplementationOnce(() => Promise.reject(new AgentError("sandbox test failed for c-tier3", 1)))
      .mockResolvedValue(undefined);
    const spawner: Spawner = vi.fn().mockResolvedValue(0);
    const opts: RunOptions = { ...baseOptions, sandbox: true, retries: 2 };
    delete (opts as { tier?: number }).tier;
    const exitCode = await run(opts, lineAgents, spawner);
    expect(exitCode).toBe(0);
    // 2 attempts: first fails sandbox, second succeeds.
    expect(spawner).toHaveBeenCalledTimes(2);
  });

  it("throws when runSandboxTest fails and no more retries", async () => {
    const { runSandboxTest } = await import("../src/sandbox");
    (runSandboxTest as Mock).mockClear();
    (runSandboxTest as Mock).mockImplementation(() => Promise.reject(new AgentError("sandbox test failed", 1)));
    const spawner: Spawner = vi.fn().mockResolvedValue(0);
    const opts: RunOptions = { ...baseOptions, sandbox: true, retries: 0 };
    delete (opts as { tier?: number }).tier;
    await expect(run(opts, lineAgents, spawner)).rejects.toThrow(/sandbox/);
  });
});

describe("launchAgent — run record prompt", () => {
  it("persists full prompt (no 200-char truncation)", async () => {
    const { launchAgent, killActiveChildren } = await import("../src/runner");
    const { loadRuns } = await import("../src/run-store");
    const stateDir = mkdtempSync(path.join(os.tmpdir(), "at-launch-prompt-state-"));
    const logDir = mkdtempSync(path.join(os.tmpdir(), "at-launch-prompt-logs-"));
    const longPrompt = "x".repeat(300);
    const agent = makeAgent("prompt-agent");
    try {
      const opts: RunOptions = { ...baseOptions, prompt: longPrompt, stateDir, logDir };
      await launchAgent(agent, opts);
      const runs = loadRuns(stateDir);
      expect(runs).toHaveLength(1);
      expect(runs[0].prompt).toBe(longPrompt);
      expect(runs[0].prompt).toHaveLength(300);
    } finally {
      killActiveChildren();
      rmSync(stateDir, { recursive: true, force: true });
      rmSync(logDir, { recursive: true, force: true });
    }
  });
});

describe("run — line mode error messages", () => {
  it('error says "line" not "tier-N" when all line agents deactivated', async () => {
    (health.isDeactivated as Mock).mockReturnValue(true);
    const lineAgents: AgentDef[] = [
      { name: "a", tier: 2, bin: () => "/bin/true", buildArgs: (p) => [p] },
      { name: "b", tier: 3, bin: () => "/bin/true", buildArgs: (p) => [p] },
    ];
    const opts: RunOptions = { ...baseOptions };
    delete (opts as { tier?: number }).tier;
    const spawner: Spawner = vi.fn();
    await expect(run(opts, lineAgents, spawner)).rejects.toThrow(/line/i);
  });
});

describe("writeHostChannelShim", () => {
  let tmpDir: string;
  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), `at-shim-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tmpDir, { recursive: true });
  });
  afterEach(() => {
    try {
      unlinkSync(path.join(tmpDir, ".at-host-channel.sh"));
    } catch {}
    try {
      rmdirSync(tmpDir);
    } catch {}
  });

  it("writes an executable shim that exports the right env and execs at", async () => {
    const { writeHostChannelShim } = await import("../src/runner");
    const shim = writeHostChannelShim({
      cwd: tmpDir,
      atBin: "'/bin/node' '/repo/dist/cli.js'",
      stateDir: "/tmp/sb-XXX/state",
      runId: "red-fox-1",
    });
    expect(shim).toBe(path.join(tmpDir, ".at-host-channel.sh"));
    expect(existsSync(shim)).toBe(true);
    const body = readFileSync(shim, "utf8");
    expect(body).toContain("AT_STATE_DIR=/tmp/sb-XXX/state");
    expect(body).toContain("AT_RUN_ID=red-fox-1");
    // AT_BIN value is shell-quoted because it has spaces — single-quote
    // escaped form may appear, but the inner `node /path/cli.js` text must.
    expect(body).toContain("'/bin/node'");
    expect(body).toContain("'/repo/dist/cli.js'");
    expect(body).toContain("exec");
    expect(body).toContain('"$@"');
    // Executable bit set so the LLM can run it directly.
    expect((require("node:fs") as typeof import("fs")).statSync(shim).mode & 0o111).not.toBe(0);
  });

  it("returns empty string when no cwd is provided", async () => {
    const { writeHostChannelShim } = await import("../src/runner");
    const shim = writeHostChannelShim({
      atBin: "at",
      stateDir: "/tmp/sb",
      runId: "r1",
    });
    expect(shim).toBe("");
  });
});
