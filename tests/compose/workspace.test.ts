import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ComposeWorkspace } from "../../src/compose/workspace";

let tmpBase: string;

beforeEach(async () => {
  tmpBase = await mkdtemp(path.join(os.tmpdir(), "compose-ws-"));
});

afterEach(async () => {
  await rm(tmpBase, { recursive: true, force: true });
});

describe("ComposeWorkspace", () => {
  it("creates goalDir under baseDir", async () => {
    const ws = new ComposeWorkspace("goal-123", tmpBase);
    await ws.ensure();
    const s = await stat(ws.goalDir);
    expect(s.isDirectory()).toBe(true);
  });

  it("defaults goalDir under ~/.at/compose", () => {
    const ws = new ComposeWorkspace("goal-default");
    expect(ws.goalDir).toContain(path.join(".at", "compose", "goal-default"));
  });

  it("writes and reads a file", async () => {
    const ws = new ComposeWorkspace("goal-abc", tmpBase);
    await ws.write("plan.md", "# Plan\n- [ ] 1. Do thing\n");
    const content = await ws.read("plan.md");
    expect(content).toContain("Do thing");
  });

  it("write leaves no temp files behind", async () => {
    const ws = new ComposeWorkspace("goal-abc", tmpBase);
    await ws.write("a.md", "first");
    await ws.write("a.md", "second");
    const entries = await readdir(ws.goalDir);
    expect(entries).toEqual(["a.md"]);
    expect(await ws.read("a.md")).toBe("second");
  });

  it("exists() returns correct values", async () => {
    const ws = new ComposeWorkspace("goal-abc", tmpBase);
    await ws.write("context.md", "# Ctx");
    expect(await ws.exists("context.md")).toBe(true);
    expect(await ws.exists("missing.md")).toBe(false);
  });

  it("hasPlan() reflects plan.md presence", async () => {
    const ws = new ComposeWorkspace("goal-xyz", tmpBase);
    expect(await ws.hasPlan()).toBe(false);
    await ws.write("requirements.md", "");
    expect(await ws.hasPlan()).toBe(false);
    await ws.write("plan.md", "# Plan");
    expect(await ws.hasPlan()).toBe(true);
  });

  it("remove() deletes a file and ignores missing files", async () => {
    const ws = new ComposeWorkspace("goal-rm", tmpBase);
    await ws.write("verdict.md", "PASS");
    await ws.remove("verdict.md");
    expect(await ws.exists("verdict.md")).toBe(false);
    await expect(ws.remove("verdict.md")).resolves.toBeUndefined();
  });

  // New test for edge case: empty plan.md file
  it("hasPlan() returns true when plan.md exists but is empty", async () => {
    const ws = new ComposeWorkspace("goal-empty", tmpBase);
    await ws.write("plan.md", "");
    expect(await ws.hasPlan()).toBe(true);
  });
});
