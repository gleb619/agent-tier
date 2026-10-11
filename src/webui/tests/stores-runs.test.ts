import { get } from "svelte/store";
import { beforeEach, describe, expect, it } from "vitest";
import {
  activeRuns,
  applySseEvent,
  completedRuns,
  runs,
  selectedRun,
  selectRun,
  setRuns,
  upsertRun,
} from "../stores/runs";
import type { ApiRun, NotifyEvent } from "../types/api";

function run(partial: Partial<ApiRun>): ApiRun {
  return {
    runId: "r1",
    agent: "mm-code",
    tier: 2,
    pid: 1,
    prompt: "p",
    logFile: "/tmp/r1.log",
    startedAt: "2026-10-11T10:00:00.000Z",
    finishedAt: null,
    exitCode: null,
    status: "running",
    name: "UNNAMED",
    ...partial,
  };
}

function evt(type: NotifyEvent["type"], runId = "r1"): NotifyEvent {
  return { runId, agent: "mm-code", ts: "2026-10-11T10:00:01.000Z", seq: 1, type };
}

describe("runs store", () => {
  beforeEach(() => {
    runs.set([]);
    selectRun(null);
  });

  it("setRuns sorts newest first", () => {
    setRuns([
      run({ runId: "old", startedAt: "2026-10-10T10:00:00.000Z" }),
      run({ runId: "new", startedAt: "2026-10-11T10:00:00.000Z" }),
    ]);
    expect(get(runs).map((r) => r.runId)).toEqual(["new", "old"]);
  });

  it("upsertRun appends unknown runs and replaces known ones", () => {
    upsertRun(run({ runId: "r1" }));
    upsertRun(run({ runId: "r2" }));
    upsertRun(run({ runId: "r1", status: "done", exitCode: 0 }));
    expect(get(runs).map((r) => r.runId)).toEqual(["r1", "r2"]);
    expect(get(runs)[0]?.status).toBe("done");
  });

  it("activeRuns = running, completedRuns = done|failed", () => {
    setRuns([
      run({ runId: "a", status: "running" }),
      run({ runId: "b", status: "done" }),
      run({ runId: "c", status: "failed" }),
      run({ runId: "d", status: "stuck" }),
    ]);
    expect(get(activeRuns).map((r) => r.runId)).toEqual(["a"]);
    expect(
      get(completedRuns)
        .map((r) => r.runId)
        .sort(),
    ).toEqual(["b", "c"]);
  });

  it("selectRun exposes the selected run (or null)", () => {
    setRuns([run({ runId: "r1" })]);
    selectRun("r1");
    expect(get(selectedRun)?.runId).toBe("r1");
    selectRun("missing");
    expect(get(selectedRun)).toBeNull();
    selectRun(null);
    expect(get(selectedRun)).toBeNull();
  });

  it("applySseEvent maps start→running, done→done, error→failed", () => {
    setRuns([run({ runId: "r1", status: "stuck" })]);
    applySseEvent(evt("start"));
    expect(get(runs)[0]?.status).toBe("running");
    applySseEvent(evt("done"));
    expect(get(runs)[0]?.status).toBe("done");
    applySseEvent(evt("error"));
    expect(get(runs)[0]?.status).toBe("failed");
  });

  it("applySseEvent leaves status alone for message/tool/progress/question/answer", () => {
    setRuns([run({ runId: "r1", status: "running" })]);
    for (const t of ["message", "tool", "progress", "question", "answer"] as const) {
      applySseEvent(evt(t));
      expect(get(runs)[0]?.status).toBe("running");
    }
  });

  it("applySseEvent matches runs by id prefix (scoped joined ids stay full)", () => {
    setRuns([run({ runId: "abcdef123456" })]);
    applySseEvent(evt("done", "abcdef"));
    expect(get(runs)[0]?.status).toBe("done");
  });

  it("applySseEvent marks a terminal run finishedAt when missing", () => {
    setRuns([run({ runId: "r1", status: "running", finishedAt: null })]);
    applySseEvent(evt("done"));
    expect(get(runs)[0]?.finishedAt).toBeTruthy();
  });

  it("applySseEvent ignores events for unknown runs", () => {
    setRuns([run({ runId: "r1" })]);
    applySseEvent(evt("done", "zzz"));
    expect(get(runs)[0]?.status).toBe("running");
  });
});
