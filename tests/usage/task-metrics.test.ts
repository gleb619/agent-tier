import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { addRun, loadRuns, type RunRecord, updateRun } from "../../src/run-store";
import {
  aggregateTaskMetrics,
  loadTaskMetrics,
  recordRunForTask,
  recordTaskMetric,
} from "../../src/usage/task-metrics";

const dirs: string[] = [];
function tmp(): string {
  const d = mkdtempSync(path.join(os.tmpdir(), "at-tm-"));
  dirs.push(d);
  return d;
}
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop() as string, { recursive: true, force: true });
});

function run(dir: string, over: Partial<RunRecord> = {}): RunRecord {
  const logFile = path.join(dir, "r1.log");
  writeFileSync(logFile, '{"usage":{"inputTokens":100,"outputTokens":40}}\n');
  return {
    runId: "r1",
    agent: "qwen",
    tier: 2,
    pid: 1,
    prompt: "do it",
    logFile,
    startedAt: "2026-10-15T10:00:00.000Z",
    finishedAt: null,
    exitCode: null,
    status: "running",
    name: "unnamed",
    ...over,
  };
}

describe("updateRun usage capture", () => {
  it("fills usage once when finishedAt lands", async () => {
    const dir = tmp();
    await addRun(dir, run(dir));
    await updateRun(dir, "r1", { status: "running" });
    expect(loadRuns(dir)[0].usage).toBeUndefined();
    await updateRun(dir, "r1", { status: "done", exitCode: 0, finishedAt: "2026-10-15T10:12:00.000Z" });
    expect(loadRuns(dir)[0].usage).toEqual({ tokensIn: 100, tokensOut: 40, source: "reported" });
  });
});

describe("task metrics", () => {
  it("recordRunForTask copies time + usage; re-record is idempotent", async () => {
    const dir = tmp();
    await addRun(dir, run(dir));
    await updateRun(dir, "r1", { status: "done", exitCode: 0, finishedAt: "2026-10-15T10:12:00.000Z" });
    await recordRunForTask(dir, "r1", "T9");
    await recordRunForTask(dir, "r1", "T9");
    const rows = loadTaskMetrics(dir);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ taskId: "T9", runId: "r1", ms: 12 * 60_000, tokensIn: 100, tokensOut: 40 });
  });

  it("unknown run is a no-op", async () => {
    const dir = tmp();
    await recordRunForTask(dir, "nope", "T1");
    expect(loadTaskMetrics(dir)).toEqual([]);
  });

  it("aggregates retries per task", async () => {
    const dir = tmp();
    const base = { agent: "a", source: "reported" as const, ts: "t" };
    await recordTaskMetric(dir, { ...base, taskId: "T1", runId: "a", ms: 1000, tokensIn: 10, tokensOut: 5 });
    await recordTaskMetric(dir, {
      ...base,
      taskId: "T1",
      runId: "b",
      ms: 2000,
      tokensIn: 20,
      tokensOut: 5,
      source: "estimated",
    });
    await recordTaskMetric(dir, { ...base, taskId: "T2", runId: "c", ms: 500, tokensIn: 1, tokensOut: 1 });
    const t = aggregateTaskMetrics(loadTaskMetrics(dir));
    expect(t.get("T1")).toEqual({
      taskId: "T1",
      runs: 2,
      ms: 3000,
      tokensIn: 30,
      tokensOut: 10,
      tokens: 40,
      estimated: true,
    });
    expect(t.get("T2")?.estimated).toBe(false);
  });
});
