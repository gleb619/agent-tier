import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type ComposeState, loadState, saveState, STATE_FILE } from "../../src/compose/state";
import { ComposeWorkspace } from "../../src/compose/workspace";

let tmpBase: string;
let ws: ComposeWorkspace;

beforeEach(async () => {
  tmpBase = await mkdtemp(path.join(os.tmpdir(), "compose-state-"));
  ws = new ComposeWorkspace("goal-1", tmpBase);
});

afterEach(async () => {
  await rm(tmpBase, { recursive: true, force: true });
});

const SAMPLE: ComposeState = {
  goal: "add login form",
  state: "IMPLEMENT",
  round: 2,
  testCmd: "npm run check",
  maxRounds: 5,
};

describe("saveState/loadState", () => {
  it("roundtrips a state object through state.json", async () => {
    await saveState(ws, SAMPLE);
    const loaded = await loadState(ws);
    expect(loaded).toEqual(SAMPLE);
  });

  it("loadState returns null when state.json is missing", async () => {
    expect(await loadState(ws)).toBeNull();
  });

  it("saveState overwrites previous state", async () => {
    await saveState(ws, SAMPLE);
    const next: ComposeState = { ...SAMPLE, state: "DONE", round: 3 };
    await saveState(ws, next);
    expect(await loadState(ws)).toEqual(next);
  });

  it("loadState throws on invalid JSON", async () => {
    await ws.write(STATE_FILE, "{ not json");
    await expect(loadState(ws)).rejects.toThrow();
  });

  it("loadState throws a clear error on invalid JSON", async () => {
    await ws.write(STATE_FILE, "{ not json");
    await expect(loadState(ws)).rejects.toThrow(`compose: corrupt state.json in ${ws.goalDir}`);
  });

  it("loadState rejects a payload that is not an object", async () => {
    await ws.write(STATE_FILE, "null");
    await expect(loadState(ws)).rejects.toThrow(/corrupt state.json/);
    await ws.write(STATE_FILE, '"a string"');
    await expect(loadState(ws)).rejects.toThrow(/corrupt state.json/);
    await ws.write(STATE_FILE, "[]");
    await expect(loadState(ws)).rejects.toThrow(/corrupt state.json/);
  });

  it("loadState rejects a goal that is not a string", async () => {
    await ws.write(STATE_FILE, JSON.stringify({ ...SAMPLE, goal: 42 }));
    await expect(loadState(ws)).rejects.toThrow(/corrupt state.json/);
  });

  it("loadState rejects an unknown phase", async () => {
    await ws.write(STATE_FILE, JSON.stringify({ ...SAMPLE, state: "WORKING" }));
    await expect(loadState(ws)).rejects.toThrow(/corrupt state.json/);
  });

  it("loadState rejects a non-positive-integer round", async () => {
    for (const round of [0, -1, 1.5, "2", null]) {
      await ws.write(STATE_FILE, JSON.stringify({ ...SAMPLE, round }));
      await expect(loadState(ws)).rejects.toThrow(/corrupt state.json/);
    }
  });

  it("loadState rejects a non-positive-integer maxRounds", async () => {
    for (const maxRounds of [0, -3, 2.5, "3", null]) {
      await ws.write(STATE_FILE, JSON.stringify({ ...SAMPLE, maxRounds }));
      await expect(loadState(ws)).rejects.toThrow(/corrupt state.json/);
    }
  it("loadState rejects a testCmd that is not a string", async () => {
    await ws.write(STATE_FILE, JSON.stringify({ ...SAMPLE, testCmd: 7 }));
    await expect(loadState(ws)).rejects.toThrow(/corrupt state.json/);
  });

  it("loadState rejects a malformed runs list", async () => {
    for (const runs of [
      "nope",
      [{ phase: "WORKING", runId: "r1" }],
      [{ phase: "IMPLEMENT", runId: 3 }],
      [{ runId: "r1" }],
    ]) {
      await ws.write(STATE_FILE, JSON.stringify({ ...SAMPLE, runs }));
      await expect(loadState(ws)).rejects.toThrow(/corrupt state.json/);
    }
  });

  it("roundtrips a state with a runs list", async () => {
    const withRuns: ComposeState = {
      ...SAMPLE,
      runs: [{ phase: "IMPLEMENT", item: 2, runId: "abc" }],
    };
    await saveState(ws, withRuns);
    expect(await loadState(ws)).toEqual(withRuns);
  });

  it("loadState still accepts a state without runs (backward compatible)", async () => {
    await saveState(ws, SAMPLE);
    const loaded = await loadState(ws);
    expect(loaded).toEqual(SAMPLE);
    expect(loaded?.runs).toBeUndefined();
  });

  it("saveState leaves no temp or lock files in the goal dir", async () => {
    await saveState(ws, SAMPLE);
    const entries = await readdir(ws.goalDir);
    expect(entries.filter((e) => e.includes(".tmp-") || e.endsWith(".lock"))).toEqual([]);
  });
});
