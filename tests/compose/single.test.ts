import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type CommandResult, type ComposeDeps, runCompose } from "../../src/compose/machine";
import { loadState, saveState } from "../../src/compose/state";
import { parsePlanKeywords, taskKeywords } from "../../src/compose/task-source";
import { ComposeWorkspace } from "../../src/compose/workspace";
import type { DiscussEntry } from "../../src/notify/types";

const TWO_AGENT_PLAN = "# Plan\n\n## Tasks\n- [ ] 1. Add resolver retry\n";

function makeDeps(ws: ComposeWorkspace, testCodes: number[] = [0]) {
  const starts: Array<{ tier: number; prompt: string; agent?: string }> = [];
  const cmds: string[] = [];
  const queries: string[] = [];
  const brain: string[] = [];
  let tests = 0;
  const deps: ComposeDeps = {
    workspace: ws,
    stateDir: path.join(path.dirname(path.dirname(ws.goalDir)), "at-state"),
    async startAt(tier, prompt, _cwd, opts) {
      starts.push({ tier, prompt, agent: opts?.agent });
      // Two-agent mode needs the tier-1 artifacts the real agents would leave behind.
      if (tier === 1 && prompt.includes("verdict.md")) await ws.write("verdict.md", "PASS\n");
      else if (tier === 1) await ws.write("plan.md", TWO_AGENT_PLAN);
      return { runId: `r${starts.length}` };
    },
    async waitRun(_id, { onQuestion }) {
      const q: DiscussEntry = { id: "m1", from: "agent", kind: "question", text: "?", ts: "t" };
      expect(await onQuestion(q)).toBeUndefined();
      return { code: 0, output: "ok" } as CommandResult;
    },
    async askBrain(p) {
      brain.push(p);
      return "x";
    },
    async runCmd(cmd) {
      cmds.push(cmd);
      if (cmd === "git diff" || cmd.startsWith("at index")) return { code: 0, output: "" };
      const code = testCodes[Math.min(tests++, testCodes.length - 1)];
      return { code, output: code === 0 ? "ok" : "FAILED: retry spec" };
    },
    async codegraph(goal) {
      queries.push(goal);
      return "CTX";
    },
  };
  return { deps, starts, cmds, queries, brain };
}

let base: string;
let ws: ComposeWorkspace;
beforeEach(async () => {
  base = await mkdtemp(path.join(os.tmpdir(), "compose-single-"));
  await mkdir(path.join(base, "project", ".codegraph"), { recursive: true });
  ws = new ComposeWorkspace("g1", path.join(base, "ws"));
});
afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});
const cwd = () => path.join(base, "project");

describe("single mode (default)", () => {
  it("one tier-2 run, no PLAN/CHECK agents, no brain, DONE on green tests", async () => {
    const f = makeDeps(ws);
    const res = await runCompose({ goal: "add retry", cwd: cwd() }, f.deps);
    expect(res.state).toBe("DONE");
    expect(f.starts.map((s) => s.tier)).toEqual([2]);
    expect(f.starts[0].prompt).toContain("add retry");
    expect(f.starts[0].prompt).toContain("CTX");
    expect(f.brain).toEqual([]);
    expect(f.starts[0].agent).toBeUndefined();
    expect((await loadState(ws))?.mode).toBe("single");
  });

  it("--tier picks the implementer tier", async () => {
    const f = makeDeps(ws);
    await runCompose({ goal: "g", cwd: cwd(), tier: 1 }, f.deps);
    expect(f.starts.map((s) => s.tier)).toEqual([1]);
  });

  it("--agent pins the single implementer run", async () => {
    const f = makeDeps(ws);
    const res = await runCompose({ goal: "g", cwd: cwd(), agent: "qwen" }, f.deps);
    expect(res.state).toBe("DONE");
    expect(f.starts.map((s) => s.agent)).toEqual(["qwen"]);
  });

  it("--agent keeps the test gate and re-runs on the same agent", async () => {
    const f = makeDeps(ws, [1, 0]);
    const res = await runCompose({ goal: "g", cwd: cwd(), agent: "qwen" }, f.deps);
    expect(res.state).toBe("DONE");
    expect(f.starts.map((s) => s.agent)).toEqual(["qwen", "qwen"]);
  });

  it("--agent is ignored in plan-then-do mode", async () => {
    const f = makeDeps(ws);
    const res = await runCompose({ goal: "g", cwd: cwd(), planThenDo: true, agent: "qwen" }, f.deps);
    expect(res.state).toBe("DONE");
    expect(f.starts.length).toBeGreaterThan(1);
    expect(f.starts.every((s) => s.agent === undefined)).toBe(true);
  });

  it("red tests re-run the implementer with the test output, then DONE", async () => {
    const f = makeDeps(ws, [1, 0]);
    const res = await runCompose({ goal: "g", cwd: cwd() }, f.deps);
    expect(res.state).toBe("DONE");
    expect(res.round).toBe(2);
    expect(f.starts).toHaveLength(2);
    expect(f.starts[1].prompt).toContain("tests FAILED");
    expect(f.starts[1].prompt).toContain("FAILED: retry spec");
  });

  it("FAILED when tests stay red after maxRounds", async () => {
    const f = makeDeps(ws, [1]);
    const res = await runCompose({ goal: "g", cwd: cwd(), maxRounds: 2 }, f.deps);
    expect(res.state).toBe("FAILED");
    expect(f.starts).toHaveLength(2);
  });

  it("resumes a pre-mode state.json as Plan-then-do", async () => {
    await ws.ensure();
    await saveState(ws, { goal: "g", state: "DONE", round: 1, testCmd: "npm test", maxRounds: 3 });
    const f = makeDeps(ws);
    await runCompose({ goal: "g", cwd: cwd() }, f.deps);
    expect(f.starts).toHaveLength(0);
  });
});

describe("keywords", () => {
  it("codegraph query uses keywords instead of the goal text", async () => {
    const f = makeDeps(ws);
    await runCompose({ goal: "long goal with whole plan", keywords: ["auth", "jwt"], cwd: cwd() }, f.deps);
    expect(f.queries).toEqual(["auth jwt"]);
    expect(await ws.read("context.md")).toContain("Keywords: auth, jwt");
  });

  it("merges task plan-file keywords", async () => {
    const plan = path.join(base, "plan.md");
    await writeFile(plan, "---\nkeywords: [resolver, retry]\n---\n# P\n");
    const f = makeDeps(ws);
    await runCompose({ task: { id: "T1", title: "t", description: "", planFile: plan }, cwd: cwd() }, f.deps);
    expect(f.queries).toEqual(["resolver retry"]);
  });

  it("falls back to the goal when no keywords", async () => {
    const f = makeDeps(ws);
    await runCompose({ goal: "just goal", cwd: cwd() }, f.deps);
    expect(f.queries).toEqual(["just goal"]);
  });

  it("parsePlanKeywords: front matter, plain line, labels, bold, dedupe, none", () => {
    expect(parsePlanKeywords("---\nkeywords: a, b\n---\n")).toEqual(["a", "b"]);
    expect(parsePlanKeywords("# T\n\nKeywords: `src/x.ts`, y, y\n")).toEqual(["src/x.ts", "y"]);
    expect(parsePlanKeywords("Labels: [one, two]")).toEqual(["one", "two"]);
    expect(parsePlanKeywords("**Keywords:** foo")).toEqual(["foo"]);
    expect(parsePlanKeywords("# no keywords here\nstatus: x")).toEqual([]);
  });

  it("taskKeywords: missing plan file → []", async () => {
    expect(await taskKeywords({ id: "T1", title: "t", description: "", planFile: path.join(base, "nope.md") })).toEqual(
      [],
    );
  });
});
