/**
 * Naming queue + lock serialization + reflective draining.
 *
 * Covers the on-disk contract: `<stateDir>/namer.lock` (via lock.ts,
 * derived as `<stateDir>/locks/<namer.lock>.lock`) serializes LLM naming
 * across concurrent `at` processes; `<stateDir>/naming-queue.jsonl` holds
 * jobs that could not be named (lock timeout); `drainNamingQueue` re-attempts
 * them with reflection from the run's stored log file.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { generateSessionNameMock } = vi.hoisted(() => ({
  generateSessionNameMock: vi.fn(),
}));

vi.mock("../src/namer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/namer")>();
  return { ...actual, generateSessionName: generateSessionNameMock };
});

import { acquireLock, releaseLock } from "../src/lock";
import { applyRunName, drainNamingQueue, getNamingQueueFile, readLogTail } from "../src/naming";
import { loadRuns, type RunRecord } from "../src/run-store";
import { runStatus } from "../src/status";

const dirs: string[] = [];

function freshDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "at-naming-queue-"));
  dirs.push(dir);
  return dir;
}

function seedRun(stateDir: string, runId: string, logFile: string): void {
  const record: RunRecord = {
    runId,
    agent: "mock",
    tier: 4,
    pid: 12345,
    prompt: "fix the thing",
    logFile,
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    exitCode: 0,
    status: "done",
    name: "unnamed",
  };
  writeFileSync(path.join(stateDir, "runs.jsonl"), `${JSON.stringify(record)}\n`, "utf8");
  writeFileSync(path.join(stateDir, "state.json"), "{}", "utf8");
}

function enqueue(stateDir: string, job: Record<string, unknown>): void {
  writeFileSync(getNamingQueueFile(stateDir), `${JSON.stringify(job)}\n`, "utf8");
}

function readQueueLines(stateDir: string): Array<Record<string, unknown>> {
  const raw = readFileSync(getNamingQueueFile(stateDir), "utf8").trim();
  if (!raw) return [];
  return raw.split("\n").map((l) => JSON.parse(l) as Record<string, unknown>);
}

beforeEach(() => {
  vi.clearAllMocks();
  generateSessionNameMock.mockResolvedValue({ name: "queue-drained-name", provider: "fake" });
});

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

describe("readLogTail", () => {
  it("returns the last maxBytes of the log, the whole log when small, empty on error", () => {
    const dir = freshDir();
    const logFile = path.join(dir, "run.log");
    writeFileSync(logFile, "a".repeat(100), "utf8");
    expect(readLogTail(logFile, 10)).toBe("a".repeat(10));
    expect(readLogTail(logFile, 1000)).toBe("a".repeat(100));
    expect(readLogTail(path.join(dir, "missing.log"))).toBe("");
  });
});

describe("namer lock serialization", () => {
  it("serializes two concurrent applyRunName calls (no overlapping provider calls)", async () => {
    const stateDir = freshDir();
    const intervals: Array<{ start: number; end: number }> = [];
    generateSessionNameMock.mockImplementation(async () => {
      const start = Date.now();
      await new Promise((r) => setTimeout(r, 40));
      intervals.push({ start, end: Date.now() });
      return { name: "serialized-name", provider: "fake" };
    });

    await Promise.all([
      applyRunName({ stateDir, runId: "r1", prompt: "first prompt" }),
      applyRunName({ stateDir, runId: "r2", prompt: "second prompt" }),
    ]);

    expect(generateSessionNameMock).toHaveBeenCalledTimes(2);
    expect(intervals).toHaveLength(2);
    const [a, b] = intervals;
    // Strictly serialized: the later call starts only after the earlier ended.
    expect(Math.max(a!.start, b!.start)).toBeGreaterThanOrEqual(Math.min(a!.end, b!.end));
  });

  it("enqueues the job to naming-queue.jsonl when the lock cannot be acquired in time", async () => {
    const stateDir = freshDir();
    const lockPath = await acquireLock(path.join(stateDir, "namer.lock"), 1000);
    try {
      const out = await applyRunName({
        stateDir,
        runId: "queued-run",
        prompt: "do stuff",
        logFile: "/tmp/at-logs/queued.log",
        lockTimeoutMs: 150,
      });
      expect(out).toBeNull();
      expect(generateSessionNameMock).not.toHaveBeenCalled();
      const jobs = readQueueLines(stateDir);
      expect(jobs).toHaveLength(1);
      expect(jobs[0]).toMatchObject({
        runId: "queued-run",
        stateDir,
        logFile: "/tmp/at-logs/queued.log",
        prompt: "do stuff",
      });
      expect(jobs[0]!.enqueuedAt).toBeTruthy();
    } finally {
      releaseLock(lockPath);
    }
  });
});

describe("drainNamingQueue", () => {
  it("names a queued run from its stored log file and removes it from the queue", async () => {
    const stateDir = freshDir();
    const logFile = path.join(stateDir, "run.log");
    writeFileSync(logFile, "fixed the auth module\nall tests green\n", "utf8");
    seedRun(stateDir, "run-drain", logFile);
    enqueue(stateDir, {
      runId: "run-drain",
      stateDir,
      logFile,
      prompt: "fix auth",
      enqueuedAt: new Date().toISOString(),
    });

    let captured: { prompt: string; opts: Record<string, unknown> } | undefined;
    generateSessionNameMock.mockImplementation(async (prompt: string, _s: string, opts: Record<string, unknown>) => {
      captured = { prompt, opts };
      return { name: "reflective-auth-fix", provider: "fake" };
    });

    await expect(drainNamingQueue(stateDir)).resolves.toBeUndefined();

    expect(generateSessionNameMock).toHaveBeenCalledTimes(1);
    expect(captured!.prompt).toBe("fix auth");
    expect(String(captured!.opts.context)).toContain("fixed the auth module");
    expect(captured!.opts.quiet).toBe(true);
    expect(loadRuns(stateDir).find((r) => r.runId === "run-drain")?.name).toBe("reflective-auth-fix");
    expect(readFileSync(getNamingQueueFile(stateDir), "utf8").trim()).toBe("");
  });

  it("keeps the job in the queue when naming fails (provider fallback)", async () => {
    const stateDir = freshDir();
    const logFile = path.join(stateDir, "run.log");
    writeFileSync(logFile, "output\n", "utf8");
    seedRun(stateDir, "run-fail", logFile);
    enqueue(stateDir, {
      runId: "run-fail",
      stateDir,
      logFile,
      prompt: "p",
      enqueuedAt: new Date().toISOString(),
    });
    generateSessionNameMock.mockResolvedValue({ name: "unnamed", provider: null });

    await drainNamingQueue(stateDir);

    expect(readQueueLines(stateDir)).toHaveLength(1);
    expect(loadRuns(stateDir).find((r) => r.runId === "run-fail")?.name).toBe("unnamed");
  });

  it("treats a corrupt queue file as empty and self-heals it (no throw)", async () => {
    const stateDir = freshDir();
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(getNamingQueueFile(stateDir), "not-json{{{\n", "utf8");

    await expect(drainNamingQueue(stateDir)).resolves.toBeUndefined();

    expect(generateSessionNameMock).not.toHaveBeenCalled();
    expect(readFileSync(getNamingQueueFile(stateDir), "utf8")).toBe("");
  });

  it("is a no-op when the queue file is missing", async () => {
    const stateDir = freshDir();
    await expect(drainNamingQueue(stateDir)).resolves.toBeUndefined();
    expect(generateSessionNameMock).not.toHaveBeenCalled();
    expect(existsSync(getNamingQueueFile(stateDir))).toBe(false);
  });
});

describe("runStatus drains the naming queue", () => {
  it("runStatus --json drains a queued job, renames the run, and stays silent on stderr", async () => {
    const stateDir = freshDir();
    const logFile = path.join(stateDir, "run.log");
    writeFileSync(logFile, "implemented reflective naming\n", "utf8");
    seedRun(stateDir, "run-silent", logFile);
    enqueue(stateDir, {
      runId: "run-silent",
      stateDir,
      logFile,
      prompt: "name me",
      enqueuedAt: new Date().toISOString(),
    });

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    let stdout = "";
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
      stdout += String(chunk);
      return true;
    });
    try {
      await runStatus(stateDir, { json: true });
    } finally {
      stdoutSpy.mockRestore();
      stderrSpy.mockRestore();
      warnSpy.mockRestore();
    }

    const parsed = JSON.parse(stdout) as { total: number; runs: Array<{ runId: string; name: string }> };
    expect(parsed.total).toBe(1);
    expect(parsed.runs[0]!.name).toBe("queue-drained-name");
    expect(stderrSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(readQueueLines(stateDir)).toHaveLength(0);
  });
});
