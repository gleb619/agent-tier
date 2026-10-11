import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type ComposeState, loadState, saveState } from "../../src/compose/state";
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
    await ws.write("state.json", "{ not json");
    await expect(loadState(ws)).rejects.toThrow();
  });
});
