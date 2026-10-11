import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type CommandResult, type ComposeDeps, runCompose } from "../../src/compose/machine";
import { allDone } from "../../src/compose/md-state";
import { loadState, saveState } from "../../src/compose/state";
import { ComposeWorkspace } from "../../src/compose/workspace";

const PLAN = `# Plan

## Requirements
- retries on transient errors

## Design
- wrap pick() in resolver

## Tasks
- [ ] 1. Add resolver retry
- [ ] 2. Add tests for retry
`;

const REPLAN = `# Plan

## Requirements
- retries on transient errors

## Design
- wrap pick() in resolver

## Tasks
- [x] 1. Add resolver retry
- [x] 2. Add tests for retry
- [ ] 3. Cover ECONNRESET in tests
`;

const FAIL_VERDICT = "FAIL\n\n- retry not covered by tests\n";

interface FakeCall {
  kind: "at" | "cmd";
  tier?: number;
  prompt?: string;
  cmd?: string;
  cwd: string;
}

interface FakeOptions {
  at?: (tier: number, prompt: string, cwd: string) => Promise<CommandResult> | CommandResult;
  cmd?: (cmd: string, cwd: string) => Promise<CommandResult> | CommandResult;
  codegraph?: (goal: string, maxNodes: number) => Promise<string>;
  /** plan.md contents written by successive PLAN calls (last one repeats) */
  plans?: string[];
  /** verdict.md contents written by successive CHECK calls (last one repeats) */
  verdicts?: string[];
  devCode?: number;
  writeVerdict?: boolean;
}

function pick(list: string[], n: number): string {
  return list[Math.min(n, list.length - 1)];
}

function makeDeps(ws: ComposeWorkspace, opts: FakeOptions = {}) {
  const calls: FakeCall[] = [];
  const plans = opts.plans ?? [PLAN];
  const verdicts = opts.verdicts ?? ["PASS\n"];
  const devCode = opts.devCode ?? 0;
  const writeVerdict = opts.writeVerdict ?? true;
  let plansWritten = 0;
  let verdictsWritten = 0;

  const deps: ComposeDeps = {
    workspace: ws,
    async runAt(tier, prompt, cwd) {
      calls.push({ kind: "at", tier, prompt, cwd });
      if (opts.at) return opts.at(tier, prompt, cwd);
      if (tier === 2) return { code: devCode, output: devCode === 0 ? "implemented" : "agent blew up" };
      if (prompt.includes("verdict.md")) {
        if (writeVerdict) await ws.write("verdict.md", pick(verdicts, verdictsWritten));
        verdictsWritten++;
        return { code: 0, output: "" };
      }
      await ws.write("plan.md", pick(plans, plansWritten));
      plansWritten++;
      return { code: 0, output: "" };
    },
    async runCmd(cmd, cwd) {
      calls.push({ kind: "cmd", cmd, cwd });
      if (opts.cmd) return opts.cmd(cmd, cwd);
      if (cmd === "git diff") return { code: 0, output: "diff --git a/src/resolver.ts\n+retry()" };
      return { code: 0, output: "tests ok" };
    },
    codegraph: opts.codegraph ?? (async () => "CTX: src/resolver.ts pick()"),
  };

  return {
    deps,
    calls,
    at: () => calls.filter((c) => c.kind === "at"),
    atTiers: () => calls.filter((c) => c.kind === "at").map((c) => c.tier),
    cmds: () => calls.filter((c) => c.kind === "cmd").map((c) => c.cmd),
    planPrompts: () =>
      calls
        .filter((c) => c.kind === "at" && c.tier === 1 && !c.prompt?.includes("verdict.md"))
        .map((c) => c.prompt as string),
    checkPrompts: () =>
      calls.filter((c) => c.kind === "at" && c.prompt?.includes("verdict.md")).map((c) => c.prompt as string),
  };
}

let base: string;
let projectDir: string;
let ws: ComposeWorkspace;

beforeEach(async () => {
  base = await mkdtemp(path.join(os.tmpdir(), "compose-machine-"));
  projectDir = path.join(base, "project");
  await mkdir(path.join(projectDir, ".codegraph"), { recursive: true });
  ws = new ComposeWorkspace("goal-1", path.join(base, "ws"));
});

afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

describe("runCompose — happy path", () => {
  it("walks INVESTIGATE → PLAN → IMPLEMENT → CHECK → DONE", async () => {
    const f = makeDeps(ws);
    const res = await runCompose({ goal: "add retry", cwd: projectDir }, f.deps);

    expect(res.state).toBe("DONE");
    expect(res.round).toBe(1);
    expect(res.goalDir).toBe(ws.goalDir);
    expect(f.atTiers()).toEqual([1, 2, 2, 1]);
    expect(f.cmds()).toContain("at index sync");
    expect(f.cmds()).toContain("npm test");
    expect(f.cmds()).toContain("git diff");
  });

  it("writes context.md from codegraph and ticks every task", async () => {
    const f = makeDeps(ws, { codegraph: async (goal, maxNodes) => `ctx for ${goal} @${maxNodes}` });
    await runCompose({ goal: "add retry", cwd: projectDir, maxNodes: 7 }, f.deps);

    expect(await ws.read("context.md")).toBe("ctx for add retry @7");
    expect(allDone(await ws.read("plan.md"))).toBe(true);
  });

  it("saves state.json after every transition", async () => {
    const f = makeDeps(ws);
    await runCompose({ goal: "add retry", cwd: projectDir, testCmd: "npm run check" }, f.deps);

    expect(await loadState(ws)).toEqual({
      goal: "add retry",
      state: "DONE",
      round: 1,
      testCmd: "npm run check",
      maxRounds: 3,
    });
  });

  it("runs at and local commands in the project cwd", async () => {
    const f = makeDeps(ws);
    await runCompose({ goal: "add retry", cwd: projectDir }, f.deps);

    expect(f.calls.every((c) => c.cwd === projectDir)).toBe(true);
  });

  it("inits codegraph before syncing when .codegraph is missing", async () => {
    const bare = path.join(base, "bare");
    await mkdir(bare, { recursive: true });
    const f = makeDeps(ws);
    await runCompose({ goal: "add retry", cwd: bare }, f.deps);

    expect(f.cmds().slice(0, 2)).toEqual(["at index init", "at index sync"]);
  });

  it("skips index init when .codegraph exists", async () => {
    const f = makeDeps(ws);
    await runCompose({ goal: "add retry", cwd: projectDir }, f.deps);

    expect(f.cmds()).not.toContain("at index init");
  });

  it("feeds plan, git diff and test output to the CHECK prompt", async () => {
    const f = makeDeps(ws);
    await runCompose({ goal: "add retry", cwd: projectDir }, f.deps);

    const check = f.checkPrompts()[0];
    expect(check).toContain("Add resolver retry");
    expect(check).toContain("+retry()");
    expect(check).toContain("tests ok");
  });
});

describe("runCompose — FAIL then re-plan then PASS", () => {
  const opts: FakeOptions = { verdicts: [FAIL_VERDICT, "PASS\n"], plans: [PLAN, REPLAN] };

  it("re-plans with the previous verdict findings and finishes DONE in round 2", async () => {
    const f = makeDeps(ws, opts);
    const res = await runCompose({ goal: "add retry", cwd: projectDir }, f.deps);

    expect(res.state).toBe("DONE");
    expect(res.round).toBe(2);
    expect(f.atTiers()).toEqual([1, 2, 2, 1, 1, 2, 1]);

    const replan = f.planPrompts()[1];
    expect(replan).toContain("retry not covered by tests");
    expect(replan).toMatch(/append/i);
    expect(replan).toMatch(/unchecked/i);
  });

  it("only implements the tasks the re-plan appended", async () => {
    const f = makeDeps(ws, opts);
    await runCompose({ goal: "add retry", cwd: projectDir }, f.deps);

    const devTasks = f
      .at()
      .filter((c) => c.tier === 2)
      .map((c) => c.prompt as string);
    expect(devTasks).toHaveLength(3);
    expect(devTasks[2]).toContain("3. Cover ECONNRESET in tests");
  });

  it("persists the round counter across the loop", async () => {
    const f = makeDeps(ws, opts);
    await runCompose({ goal: "add retry", cwd: projectDir }, f.deps);

    expect((await loadState(ws))?.round).toBe(2);
  });
});

describe("runCompose — exhausted rounds", () => {
  it("ends FAILED after maxRounds FAIL verdicts", async () => {
    const f = makeDeps(ws, { verdicts: [FAIL_VERDICT] });
    const res = await runCompose({ goal: "add retry", cwd: projectDir, maxRounds: 3 }, f.deps);

    expect(res.state).toBe("FAILED");
    expect(res.round).toBe(3);
    expect(f.checkPrompts()).toHaveLength(3);
    expect(f.planPrompts()).toHaveLength(3);
    expect((await loadState(ws))?.state).toBe("FAILED");
  });

  it("respects a lower --max-rounds", async () => {
    const f = makeDeps(ws, { verdicts: ["FAIL\n"] });
    const res = await runCompose({ goal: "add retry", cwd: projectDir, maxRounds: 1 }, f.deps);

    expect(res.state).toBe("FAILED");
    expect(f.checkPrompts()).toHaveLength(1);
    expect(f.planPrompts()).toHaveLength(1);
  });

  it("treats an unparsable verdict as FAIL", async () => {
    const f = makeDeps(ws, { verdicts: ["looks good overall, probably fine\n"] });
    const res = await runCompose({ goal: "add retry", cwd: projectDir, maxRounds: 1 }, f.deps);

    expect(res.state).toBe("FAILED");
  });
});

describe("runCompose — resume", () => {
  it("continues mid-IMPLEMENT without re-investigating or re-planning", async () => {
    await ws.write("plan.md", PLAN.replace("- [ ] 1. Add resolver retry", "- [x] 1. Add resolver retry"));
    await saveState(ws, { goal: "saved goal", state: "IMPLEMENT", round: 1, testCmd: "npm test", maxRounds: 3 });

    const f = makeDeps(ws);
    const res = await runCompose({ goal: "ignored on resume", cwd: projectDir }, f.deps);

    expect(res.state).toBe("DONE");
    expect(res.round).toBe(1);
    expect(f.cmds()).not.toContain("at index sync");
    expect(f.planPrompts()).toHaveLength(0);

    const devCalls = f.at().filter((c) => c.tier === 2);
    expect(devCalls).toHaveLength(1);
    expect(devCalls[0].prompt).toContain("2. Add tests for retry");
    expect(devCalls[0].prompt).toContain("saved goal");
    expect(allDone(await ws.read("plan.md"))).toBe(true);
  });

  it("reuses saved testCmd and maxRounds", async () => {
    await ws.write("plan.md", PLAN);
    await saveState(ws, { goal: "g", state: "CHECK", round: 2, testCmd: "make check", maxRounds: 5 });

    const f = makeDeps(ws, { verdicts: [FAIL_VERDICT] });
    const res = await runCompose({ goal: "g", cwd: projectDir }, f.deps);

    expect(f.cmds()).toContain("make check");
    expect(f.cmds()).not.toContain("npm test");
    expect(res.state).toBe("FAILED");
    expect(res.round).toBe(5);
    expect(f.checkPrompts()).toHaveLength(4);
  });

  it("returns immediately when the saved state is terminal", async () => {
    await saveState(ws, { goal: "g", state: "DONE", round: 1, testCmd: "npm test", maxRounds: 3 });

    const f = makeDeps(ws);
    const res = await runCompose({ goal: "g", cwd: projectDir }, f.deps);

    expect(res.state).toBe("DONE");
    expect(f.calls).toHaveLength(0);
  });
});

describe("runCompose — failures", () => {
  it("stops at the first failing IMPLEMENT task and names the state", async () => {
    const f = makeDeps(ws, { devCode: 1 });

    await expect(runCompose({ goal: "add retry", cwd: projectDir }, f.deps)).rejects.toThrow(/IMPLEMENT/);
    expect(f.at().filter((c) => c.tier === 2)).toHaveLength(1);
    expect(f.checkPrompts()).toHaveLength(0);
    expect((await loadState(ws))?.state).toBe("IMPLEMENT");
    expect(allDone(await ws.read("plan.md"))).toBe(false);
  });

  it("throws when PLAN produces no plan.md", async () => {
    const f = makeDeps(ws, { at: async () => ({ code: 0, output: "no files written" }) });

    await expect(runCompose({ goal: "add retry", cwd: projectDir }, f.deps)).rejects.toThrow(/PLAN/);
    expect((await loadState(ws))?.state).toBe("PLAN");
  });

  it("throws when the PLAN agent exits non-zero", async () => {
    const f = makeDeps(ws, { at: async () => ({ code: 2, output: "tier 1 unavailable" }) });

    await expect(runCompose({ goal: "add retry", cwd: projectDir }, f.deps)).rejects.toThrow(/PLAN/);
    expect((await loadState(ws))?.state).toBe("PLAN");
  });

  it("throws when CHECK produces no verdict.md", async () => {
    const f = makeDeps(ws, { writeVerdict: false });

    await expect(runCompose({ goal: "add retry", cwd: projectDir }, f.deps)).rejects.toThrow(/CHECK/);
    expect((await loadState(ws))?.state).toBe("CHECK");
  });

  it("a failing test command does not abort CHECK — it is evidence", async () => {
    const f = makeDeps(ws, {
      cmd: async (cmd) => (cmd === "git diff" ? { code: 0, output: "diff" } : { code: 1, output: "FAIL 3 tests" }),
    });
    const res = await runCompose({ goal: "add retry", cwd: projectDir }, f.deps);

    expect(res.state).toBe("DONE");
    expect(f.checkPrompts()[0]).toContain("exit code: 1");
    expect(f.checkPrompts()[0]).toContain("FAIL 3 tests");
  });

  it("truncates huge test output and diffs", async () => {
    const big = "x".repeat(50000);
    const f = makeDeps(ws, { cmd: async () => ({ code: 0, output: big }) });

    await runCompose({ goal: "add retry", cwd: projectDir }, f.deps);

    const check = f.checkPrompts()[0];
    expect(check.length).toBeLessThan(big.length);
    expect(check).toMatch(/truncated/);
  });
});
