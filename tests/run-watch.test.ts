import { buildRunWatchArgs, HEARTBEAT_INTERVAL_MS, main, POLL_INTERVAL_MS, spawnRunWatch } from "../src/run-watch";

const {
  isPidAliveMock,
  updateRunMock,
  spawnSyncMock,
  spawnMock,
  appendFileMock,
  readFileMock,
  recordResultMock,
  setDeactivatedMock,
  applyRunNameMock,
  drainNamingQueueMock,
  readLogTailMock,
} = vi.hoisted(() => ({
  isPidAliveMock: vi.fn<boolean, [number]>(),
  updateRunMock: vi.fn(async () => {}),
  spawnSyncMock: vi.fn(),
  spawnMock: vi.fn(),
  appendFileMock: vi.fn(),
  readFileMock: vi.fn(() => ""),
  recordResultMock: vi.fn(async () => {}),
  setDeactivatedMock: vi.fn(async () => {}),
  applyRunNameMock: vi.fn(async () => null),
  drainNamingQueueMock: vi.fn(async () => {}),
  readLogTailMock: vi.fn(() => ""),
}));

vi.mock("../src/process-utils", () => ({ isPidAlive: isPidAliveMock }));
vi.mock("../src/run-store", () => ({ updateRun: updateRunMock, UNNAMED_PLACEHOLDER: "unnamed" }));
vi.mock("../src/health", () => ({ recordResult: recordResultMock, setDeactivated: setDeactivatedMock }));
vi.mock("../src/naming", () => ({
  applyRunName: applyRunNameMock,
  drainNamingQueue: drainNamingQueueMock,
  readLogTail: readLogTailMock,
}));
vi.mock("child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("child_process")>();
  return { ...actual, spawnSync: spawnSyncMock, spawn: spawnMock };
});
vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  return { ...actual, appendFileSync: appendFileMock, readFileSync: readFileMock };
});

const ARGS = ["12345", "run-1", "/tmp/at-state", "test-agent", "2", "/tmp/at-logs/run.log"];

describe("run-watch — verify hook (AT_VERIFY_CMD env)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetAllMocks();
    isPidAliveMock.mockReturnValue(false);
    spawnSyncMock.mockReturnValue({ status: 0, stdout: "", stderr: "" });
  });

  afterEach(() => {
    vi.useRealTimers();
    delete process.env.AT_VERIFY_CMD;
    delete process.env.AT_CWD;
  });

  it("runs the verify command after pid dies and appends ok line on success", async () => {
    process.env.AT_VERIFY_CMD = "true";
    spawnSyncMock.mockImplementation((cmd: string) => {
      if (cmd === "true") return { status: 0, stdout: "", stderr: "" };
      return { status: 0, stdout: "", stderr: "" };
    });
    const promise = main(ARGS);
    expect(await promise).toBe(0);
    // updateRun done (first call), callback never
    expect(updateRunMock).toHaveBeenCalledWith("/tmp/at-state", "run-1", expect.objectContaining({ status: "done" }));
    // verify invoked once, callback never (ARGS has no callback slot)
    const verifyCalls = spawnSyncMock.mock.calls.filter((c) => c[0] === "true");
    expect(verifyCalls.length).toBe(1);
    expect(spawnSyncMock.mock.calls.some((c) => c[0] === "true")).toBe(true);
    const verifyLogs = appendFileMock.mock.calls.filter((c) => typeof c[1] === "string" && c[1].includes("verify ok"));
    expect(verifyLogs.length).toBe(1);
  });

  it("marks run failed, appends verify-failed log line, fires callback with AT_STATUS=failed", async () => {
    process.env.AT_VERIFY_CMD = 'sh -c "exit 7"';
    spawnSyncMock.mockImplementation((cmd: string) => {
      if (cmd === 'sh -c "exit 7"') return { status: 7, stdout: "", stderr: "boom" };
      return { status: 0, stdout: "", stderr: "" };
    });
    const promise = main([...ARGS, "cb-after-verify"]);
    expect(await promise).toBe(0);
    const calls = updateRunMock.mock.calls;
    // First updateRun: done; second: failed (verify override)
    expect(calls[0][2]).toEqual(expect.objectContaining({ status: "done" }));
    expect(calls[1][2]).toEqual(expect.objectContaining({ status: "failed" }));
    const failedLogs = appendFileMock.mock.calls.filter(
      (c) => typeof c[1] === "string" && c[1].includes("verify failed (exit 7)"),
    );
    expect(failedLogs.length).toBe(1);
    // callback fired with AT_STATUS=failed
    const cbCall = spawnSyncMock.mock.calls.find((c) => c[0] === "cb-after-verify");
    expect(cbCall).toBeDefined();
    // spawnSync(cmd, args, opts) — opts is at index 2
    expect((cbCall as any)[2].env.AT_STATUS).toBe("failed");
  });

  it("uses AT_CWD for verify when set, otherwise process.cwd()", async () => {
    process.env.AT_VERIFY_CMD = "pwd-and-stamp";
    process.env.AT_CWD = "/tmp/at-verify-cwd";
    spawnSyncMock.mockReturnValue({ status: 0, stdout: "", stderr: "" });
    const promise = main(ARGS);
    expect(await promise).toBe(0);
    const verifyCall = spawnSyncMock.mock.calls.find((c) => c[0] === "pwd-and-stamp");
    expect(verifyCall).toBeDefined();
    expect((verifyCall![2] as any).cwd).toBe("/tmp/at-verify-cwd");
    expect((verifyCall![2] as any).shell).toBe(true);
  });

  it("is unchanged behaviour when AT_VERIFY_CMD is not set (no verify, no log line)", async () => {
    delete process.env.AT_VERIFY_CMD;
    const promise = main(ARGS);
    expect(await promise).toBe(0);
    expect(spawnSyncMock).not.toHaveBeenCalled();
    expect(updateRunMock).toHaveBeenCalledTimes(1);
    expect(updateRunMock).toHaveBeenCalledWith("/tmp/at-state", "run-1", expect.objectContaining({ status: "done" }));
    const verifyLogs = appendFileMock.mock.calls.filter((c) => typeof c[1] === "string" && /verify/.test(c[1]));
    expect(verifyLogs.length).toBe(0);
  });
});

describe("run-watch main()", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetAllMocks();
    spawnSyncMock.mockReturnValue({ status: 0, stdout: "", stderr: "" });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("polls until the pid dies, then marks the run done with exitCode null", async () => {
    isPidAliveMock.mockReturnValueOnce(true).mockReturnValue(false);
    const promise = main(ARGS);
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    expect(await promise).toBe(0);
    expect(updateRunMock).toHaveBeenCalledWith("/tmp/at-state", "run-1", {
      status: "done",
      finishedAt: expect.any(String),
      exitCode: null,
    });
    expect(spawnSyncMock).not.toHaveBeenCalled();
  });

  it("appends a heartbeat line to the log every HEARTBEAT_INTERVAL_MS while alive", async () => {
    // alive for 500 polls (1000s), then dead — heartbeats expected at 5m/10m/15m
    let polls = 0;
    isPidAliveMock.mockImplementation(() => ++polls <= 500);
    const promise = main(ARGS);
    await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS * 4 + POLL_INTERVAL_MS);
    expect(await promise).toBe(0);
    const heartbeats = appendFileMock.mock.calls.filter((c) => typeof c[1] === "string" && c[1].includes("heartbeat"));
    expect(heartbeats.length).toBeGreaterThanOrEqual(3);
    expect(heartbeats[0][0]).toBe("/tmp/at-logs/run.log");
    expect(heartbeats[0][1]).toMatch(/heartbeat: test-agent pid 12345 alive/);
  });

  it("runs the callback with the AT_* env contract once the pid dies", async () => {
    isPidAliveMock.mockReturnValue(false);
    const promise = main([...ARGS, "my-callback-cmd"]);
    expect(await promise).toBe(0);
    expect(spawnSyncMock).toHaveBeenCalledTimes(1);
    expect(spawnSyncMock).toHaveBeenCalledWith("my-callback-cmd", [], {
      env: expect.objectContaining({
        AT_RUN_ID: "run-1",
        AT_AGENT: "test-agent",
        AT_TIER: "2",
        AT_EXIT_CODE: "0",
        AT_STATUS: "done",
      }),
      stdio: "ignore",
      shell: true,
    });
  });

  it("does not throw when the callback exits non-zero", async () => {
    isPidAliveMock.mockReturnValue(false);
    spawnSyncMock.mockReturnValue({ status: 7, stdout: "", stderr: "" });
    const promise = main([...ARGS, "failing-callback"]);
    expect(await promise).toBe(0);
    expect(spawnSyncMock).toHaveBeenCalledTimes(1);
  });

  it("returns 1 for an invalid pid without touching run-store", async () => {
    expect(await main(["abc", ...ARGS.slice(1)])).toBe(1);
    expect(await main(["-5", ...ARGS.slice(1)])).toBe(1);
    expect(updateRunMock).not.toHaveBeenCalled();
    expect(spawnSyncMock).not.toHaveBeenCalled();
  });
});

describe("buildRunWatchArgs", () => {
  const base = {
    pid: 42,
    runId: "r1",
    stateDir: "/tmp/s",
    agent: "a",
    tier: 2,
    logFile: "/tmp/l.log",
    prompt: "p",
  };

  it("serialises all options with a callback", () => {
    expect(buildRunWatchArgs({ ...base, callback: "cb-cmd" })).toEqual([
      "42",
      "r1",
      "/tmp/s",
      "a",
      "2",
      "/tmp/l.log",
      "cb-cmd",
    ]);
  });

  it("omits the callback argument when empty or blank", () => {
    expect(buildRunWatchArgs({ ...base, callback: "" })).toHaveLength(6);
    expect(buildRunWatchArgs({ ...base, callback: "   " })).toHaveLength(6);
    expect(buildRunWatchArgs(base)).toHaveLength(6);
  });
});

describe("run-watch — quota/rate-limit detection", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetAllMocks();
    isPidAliveMock.mockReturnValue(false);
    spawnSyncMock.mockReturnValue({ status: 0, stdout: "", stderr: "" });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("marks the run failed and records a health failure when the log tail shows 429/quota", async () => {
    readFileMock.mockReturnValue(`${"x".repeat(100)}API Error: Request rejected (429) Token Plan usage limit reached`);
    expect(await main(ARGS)).toBe(0);
    expect(updateRunMock).toHaveBeenCalledWith("/tmp/at-state", "run-1", {
      status: "failed",
      finishedAt: expect.any(String),
      exitCode: 1,
    });
    expect(recordResultMock).toHaveBeenCalledWith(expect.stringContaining("state.json"), "test-agent", false);
    expect(setDeactivatedMock).toHaveBeenCalledWith(expect.stringContaining("state.json"), "test-agent", true);
    const logged = appendFileMock.mock.calls.map((c) => String(c[1])).join("\n");
    expect(logged).toContain(`[at] agent test-agent reported fatal error: API Error: Request rejected (429)`);
    expect(logged).toContain("[at] agent test-agent deactivated (reason: quota)");
  });

  it("deactivates on a usage-limit marker regardless of case", async () => {
    readFileMock.mockReturnValue(" USAGE LIMIT HAS BEEN REACHED");
    expect(await main(ARGS)).toBe(0);
    expect(setDeactivatedMock).toHaveBeenCalledWith(expect.stringContaining("state.json"), "test-agent", true);
  });

  it("fails the run without deactivating for a non-quota fatal marker", async () => {
    readFileMock.mockReturnValue("[claude-code:unrecognized_model] model not found");
    expect(await main(ARGS)).toBe(0);
    expect(updateRunMock).toHaveBeenCalledWith("/tmp/at-state", "run-1", {
      status: "failed",
      finishedAt: expect.any(String),
      exitCode: 1,
    });
    expect(recordResultMock).toHaveBeenCalledWith(expect.stringContaining("state.json"), "test-agent", false);
    expect(setDeactivatedMock).not.toHaveBeenCalled();
  });

  it("keeps status done when the log tail has no quota markers", async () => {
    readFileMock.mockReturnValue("[at] runId: run-1\nmodel ready\nall good");
    expect(await main(ARGS)).toBe(0);
    expect(updateRunMock).toHaveBeenCalledWith("/tmp/at-state", "run-1", {
      status: "done",
      finishedAt: expect.any(String),
      exitCode: null,
    });
    expect(recordResultMock).not.toHaveBeenCalled();
  });

  it("falls back to done when the log file cannot be read", async () => {
    readFileMock.mockImplementation(() => {
      throw new Error("ENOENT");
    });
    expect(await main(ARGS)).toBe(0);
    expect(updateRunMock).toHaveBeenCalledWith("/tmp/at-state", "run-1", {
      status: "done",
      finishedAt: expect.any(String),
      exitCode: null,
    });
  });
});

describe("run-watch — supervisor naming (AT_NAME_RUN)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetAllMocks();
    isPidAliveMock.mockReturnValue(false);
    spawnSyncMock.mockReturnValue({ status: 0, stdout: "", stderr: "" });
    process.env.AT_PROMPT = "refactor the auth module";
    readLogTailMock.mockReturnValue("fixed login redirect, updated tests");
  });

  afterEach(() => {
    vi.useRealTimers();
    delete process.env.AT_NAME_RUN;
    delete process.env.AT_PROMPT;
  });

  it("names the run reflectively after the pid dies and hands the name to the callback", async () => {
    process.env.AT_NAME_RUN = "1";
    applyRunNameMock.mockResolvedValue({ name: "refactor-auth-module-oidc", provider: "local-ollama" });
    expect(await main([...ARGS, "cb"])).toBe(0);
    expect(applyRunNameMock).toHaveBeenCalledWith(
      expect.objectContaining({
        stateDir: "/tmp/at-state",
        runId: "run-1",
        prompt: "refactor the auth module",
        logFile: "/tmp/at-logs/run.log",
        logTail: "fixed login redirect, updated tests",
        cwd: expect.any(String),
      }),
    );
    expect(readLogTailMock).toHaveBeenCalledWith("/tmp/at-logs/run.log");
    const cbCall = spawnSyncMock.mock.calls.find((c) => c[0] === "cb");
    expect((cbCall as any)[2].env.AT_RUN_NAME).toBe("refactor-auth-module-oidc");
  });

  it("does not name while the supervised pid is still alive", async () => {
    process.env.AT_NAME_RUN = "1";
    isPidAliveMock.mockReturnValue(true);
    const p = main(ARGS);
    await vi.advanceTimersByTimeAsync(0);
    expect(applyRunNameMock).not.toHaveBeenCalled();
    isPidAliveMock.mockReturnValue(false);
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    expect(await p).toBe(0);
    expect(applyRunNameMock).toHaveBeenCalledTimes(1);
  });

  it("marks the run done before naming starts", async () => {
    process.env.AT_NAME_RUN = "1";
    isPidAliveMock.mockReturnValueOnce(true).mockReturnValue(false);
    const p = main(ARGS);
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    expect(await p).toBe(0);
    expect(updateRunMock).toHaveBeenCalledWith("/tmp/at-state", "run-1", expect.objectContaining({ status: "done" }));
    expect(applyRunNameMock.mock.invocationCallOrder[0]!).toBeGreaterThan(updateRunMock.mock.invocationCallOrder[0]!);
  });

  it("drains the naming queue even when it does not own naming", async () => {
    expect(await main(ARGS)).toBe(0);
    expect(drainNamingQueueMock).toHaveBeenCalledWith("/tmp/at-state");
    expect(applyRunNameMock).not.toHaveBeenCalled();
  });

  it("does not exit while naming is still in flight (fast agent would lose the name)", async () => {
    process.env.AT_NAME_RUN = "1";
    applyRunNameMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(() => resolve({ name: "slow-but-persisted-name", provider: "openrouter" }), 50);
        }),
    );
    let exited = false;
    const p = main(ARGS).then((code) => {
      exited = true;
      return code;
    });
    await vi.advanceTimersByTimeAsync(10);
    expect(exited).toBe(false);
    await vi.advanceTimersByTimeAsync(100);
    expect(await p).toBe(0);
    expect(exited).toBe(true);
  });

  it("leaves naming alone when AT_NAME_RUN is not set", async () => {
    expect(await main(ARGS)).toBe(0);
    expect(applyRunNameMock).not.toHaveBeenCalled();
  });

  it("reports the placeholder to the callback when naming failed", async () => {
    process.env.AT_NAME_RUN = "1";
    applyRunNameMock.mockResolvedValue(null);
    expect(await main([...ARGS, "cb"])).toBe(0);
    const cbCall = spawnSyncMock.mock.calls.find((c) => c[0] === "cb");
    expect((cbCall as any)[2].env.AT_RUN_NAME).toBe("unnamed");
  });
});

describe("spawnRunWatch — naming flag", () => {
  const base = {
    pid: 42,
    runId: "r1",
    stateDir: "/tmp/s",
    agent: "a",
    tier: 2,
    logFile: "/tmp/l.log",
    prompt: "do the thing",
  };

  beforeEach(() => {
    vi.resetAllMocks();
    spawnMock.mockReturnValue({ unref: vi.fn(), once: vi.fn() });
  });

  it("sets AT_NAME_RUN=1 when the supervisor should name the run", () => {
    spawnRunWatch({ ...base, nameRun: true });
    const env = (spawnMock.mock.calls[0]![2] as any).env;
    expect(env.AT_NAME_RUN).toBe("1");
    expect(env.AT_PROMPT).toBe("do the thing");
  });

  it("leaves AT_NAME_RUN unset when the parent names the run itself", () => {
    spawnRunWatch(base);
    const env = (spawnMock.mock.calls[0]![2] as any).env;
    expect(env.AT_NAME_RUN).toBeUndefined();
  });
});
