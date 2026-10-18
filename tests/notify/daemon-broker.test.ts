import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type DaemonHandle, startDaemon } from "../../src/commands/serve";
import { requestDaemon } from "../../src/notify/daemon-sock";
import { readThread } from "../../src/notify/discuss-store";
import { readEvents } from "../../src/notify/store";
import type { NotifyEvent } from "../../src/notify/types";
import { addRun, getRunsFile, loadRuns, type RunRecord, updateRun } from "../../src/run-store";
import { loadStateFile } from "../../src/scheduler";
import { getStateFilePath } from "../../src/state-dir";

function record(runId: string): RunRecord {
  return {
    runId,
    agent: "mock",
    tier: 4,
    pid: process.pid,
    prompt: `prompt ${runId}`,
    logFile: `/tmp/${runId}.log`,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    exitCode: null,
    status: "running",
    name: runId,
  };
}

function progress(i: number): NotifyEvent {
  return {
    runId: "bulk",
    agent: "mock",
    ts: new Date().toISOString(),
    seq: 0,
    type: "progress",
    text: `tick ${i}`,
  };
}

/**
 * The daemon is the single writer for runs.jsonl / state.json / the event and
 * discuss logs. These suites drive many *concurrent* clients through the
 * socket and assert nothing is lost, torn or duplicated on disk.
 */
describe("daemon lock broker", () => {
  let stateDir: string;
  let daemon: DaemonHandle | undefined;

  beforeEach(async () => {
    stateDir = mkdtempSync(path.join(tmpdir(), "at-daemon-broker-"));
    delete process.env.AT_NO_DAEMON;
    delete process.env.AT_DEPTH;
    daemon = await startDaemon({ stateDir, serveHttp: false });
  });

  afterEach(async () => {
    await daemon?.close();
    daemon = undefined;
    rmSync(stateDir, { recursive: true, force: true });
  });

  it("serves emit and discuss frames through the hub handlers", async () => {
    const emit = await requestDaemon(
      stateDir,
      "emit",
      { runId: "live", agent: "mock", ts: new Date().toISOString(), seq: 0, type: "start" } satisfies NotifyEvent,
      { timeoutMs: 2000 },
    );
    expect(emit?.ok).toBe(true);

    const discuss = await requestDaemon(
      stateDir,
      "discuss",
      { runId: "live", from: "agent", kind: "question", text: "ok to ship?" },
      { timeoutMs: 2000 },
    );
    expect(discuss?.ok).toBe(true);
    expect(discuss?.data).toMatchObject({ id: "m1" });

    expect(readEvents(stateDir, "live").some((e) => e.type === "start")).toBe(true);
    expect(readThread(stateDir, "live")).toHaveLength(1);
  });

  it("serializes concurrent addRun without losing records", async () => {
    const N = 20;
    await Promise.all(Array.from({ length: N }, (_, i) => addRun(stateDir, record(`r${i}`))));

    const lines = readFileSync(getRunsFile(stateDir), "utf8")
      .split("\n")
      .filter((l) => l.trim());
    expect(lines).toHaveLength(N);
    for (const l of lines) expect(() => JSON.parse(l)).not.toThrow();
    expect(
      loadRuns(stateDir)
        .map((r) => r.runId)
        .sort(),
    ).toEqual(Array.from({ length: N }, (_, i) => `r${i}`).sort());
  });

  it("serializes concurrent updateRun without lost writes", async () => {
    await addRun(stateDir, record("u1"));
    await Promise.all(
      Array.from({ length: 10 }, (_, i) => updateRun(stateDir, "u1", { prompt: `patched ${i}` } as Partial<RunRecord>)),
    );

    const run = loadRuns(stateDir).find((r) => r.runId === "u1");
    expect(run?.prompt).toMatch(/^patched \d+$/);
    const lines = readFileSync(getRunsFile(stateDir), "utf8")
      .split("\n")
      .filter((l) => l.trim());
    expect(lines).toHaveLength(1);
  });

  it("serializes concurrent emit frames into one intact event log", async () => {
    const N = 30;
    const res = await Promise.all(
      Array.from({ length: N }, (_, i) => requestDaemon(stateDir, "emit", progress(i), { timeoutMs: 5000 })),
    );
    expect(res.every((r) => r?.ok)).toBe(true);

    const lines = readFileSync(path.join(stateDir, "events", "bulk.jsonl"), "utf8")
      .split("\n")
      .filter((l) => l.trim());
    expect(lines).toHaveLength(N);
    const events = lines.map((l) => JSON.parse(l) as NotifyEvent);
    expect(events.map((e) => e.seq).sort((a, b) => a - b)).toEqual(Array.from({ length: N }, (_, i) => i + 1));
    expect(new Set(events.map((e) => e.text)).size).toBe(N);
  });

  it("serializes concurrent discuss frames into unique monotonic ids", async () => {
    const N = 15;
    const res = await Promise.all(
      Array.from({ length: N }, (_, i) =>
        requestDaemon(
          stateDir,
          "discuss",
          { runId: "thread", from: "agent", kind: "note", text: `note ${i}` },
          { timeoutMs: 5000 },
        ),
      ),
    );
    expect(res.every((r) => r?.ok)).toBe(true);

    const ids = res.map((r) => ((r?.data ?? {}) as { id: string }).id);
    expect(new Set(ids).size).toBe(N);
    expect(ids.map((id) => Number(id.slice(1))).sort((a, b) => a - b)).toEqual(
      Array.from({ length: N }, (_, i) => i + 1),
    );
    expect(readThread(stateDir, "thread")).toHaveLength(N);
  });

  it("serializes concurrent state.json patches", async () => {
    const N = 12;
    const res = await Promise.all(
      Array.from({ length: N }, (_, i) =>
        requestDaemon(stateDir, "state.patch", { key: `marker${i}`, value: i }, { timeoutMs: 5000 }),
      ),
    );
    expect(res.every((r) => r?.ok)).toBe(true);

    const state = loadStateFile(getStateFilePath(stateDir)) as Record<string, unknown>;
    for (let i = 0; i < N; i++) expect(state[`marker${i}`]).toBe(i);
  });

  it("rejects unknown ops and bad payloads without writing", async () => {
    const bad = await requestDaemon(stateDir, "nonsense", {}, { timeoutMs: 1000 });
    expect(bad?.ok).toBe(false);

    const noText = await requestDaemon(stateDir, "discuss", { runId: "x", kind: "note" }, { timeoutMs: 1000 });
    expect(noText?.ok).toBe(false);
    expect(existsSync(path.join(stateDir, "events", "x.discuss.jsonl"))).toBe(false);
  });

  it("falls back to the unlocked local path when the daemon is gone", async () => {
    await daemon?.close();
    daemon = undefined;

    await addRun(stateDir, record("offline"));
    expect(loadRuns(stateDir).map((r) => r.runId)).toContain("offline");
  });
});
