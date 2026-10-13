import { mkdtemp, rm, writeFile } from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type CommandResult, type ComposeDeps, runCompose } from "../../src/compose/machine";
import { loadState } from "../../src/compose/state";
import { type ComposeTask, type TaskSource, taskGoal } from "../../src/compose/task-source";
import { ComposeWorkspace } from "../../src/compose/workspace";

const PLAN_ALL_CHECKED = `# Plan

## Tasks
- [x] 1. Already done item
`;

function makeDeps(ws: ComposeWorkspace, opts: { verdict?: string; log?: (m: string) => void } = {}): ComposeDeps {
  let runCounter = 0;
  const runResults = new Map<string, CommandResult>();
  return {
    workspace: ws,
    stateDir: ws.goalDir,
    log: opts.log,
    async startAt(tier, prompt) {
      const runId = `r${++runCounter}`;
      if (tier === 1 && prompt.includes("verdict.md")) {
        await ws.write("verdict.md", opts.verdict ?? "PASS\n");
      } else if (tier === 1) {
        await ws.write("plan.md", PLAN_ALL_CHECKED);
      }
      runResults.set(runId, { code: 0, output: "" });
      return { runId };
    },
    async waitRun(runId) {
      return runResults.get(runId) ?? { code: 0, output: "" };
    },
    async askBrain() {
      return "answer";
    },
    async runCmd() {
      return { code: 0, output: "" };
    },
    async codegraph() {
      return "context";
    },
  };
}

function makeTask(overrides: Partial<ComposeTask> = {}): ComposeTask {
  return { id: "T7", title: "Add retry", description: "wrap pick() in a retry loop", ...overrides };
}

let dir: string;
let ws: ComposeWorkspace;

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "at-compose-ts-"));
  ws = new ComposeWorkspace("t7", path.join(dir, "compose"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("task-source hooks", () => {
  it("calls onPhase on each advance in order, then onFinish at the terminal state", async () => {
    const events: string[] = [];
    const task = makeTask();
    const source: TaskSource = {
      async claim() {
        return task;
      },
      async onPhase(t, phase, round) {
        events.push(`phase:${t.id}:${phase}:${round}`);
      },
      async onFinish(t, outcome, info) {
        events.push(`finish:${t.id}:${outcome}:${info.round}:${info.goalDir === ws.goalDir}`);
      },
    };
    const deps = makeDeps(ws);

    const res = await runCompose({ goal: "g", task, source, cwd: dir }, deps);

    expect(res.state).toBe("DONE");
    expect(events).toEqual([
      "phase:T7:PLAN:1",
      "phase:T7:IMPLEMENT:1",
      "phase:T7:CHECK:1",
      "phase:T7:DONE:1",
      "finish:T7:DONE:1:true",
    ]);
  });

  it("swallows hook errors, logs them, and never aborts the run", async () => {
    const logs: string[] = [];
    const task = makeTask();
    const source: TaskSource = {
      async claim() {
        return task;
      },
      async onPhase() {
        throw new Error("onPhase blew up");
      },
      async onFinish() {
        throw new Error("onFinish blew up");
      },
    };
    const deps = makeDeps(ws, { log: (m) => logs.push(m) });

    const res = await runCompose({ goal: "g", task, source, cwd: dir }, deps);

    expect(res.state).toBe("DONE");
    expect(logs.some((m) => m.includes("onPhase blew up"))).toBe(true);
    expect(logs.some((m) => m.includes("onFinish blew up"))).toBe(true);
  });

  it("runs fine when the source has no onPhase", async () => {
    const task = makeTask();
    let finished = false;
    const source: TaskSource = {
      async claim() {
        return task;
      },
      async onFinish() {
        finished = true;
      },
    };

    const res = await runCompose({ goal: "g", task, source, cwd: dir }, makeDeps(ws));

    expect(res.state).toBe("DONE");
    expect(finished).toBe(true);
  });

  it("does not call hooks when only a task (no source) is given", async () => {
    const res = await runCompose({ goal: "g", task: makeTask(), cwd: dir }, makeDeps(ws));
    expect(res.state).toBe("DONE");
  });
});

describe("goal derivation from a task", () => {
  it("uses title + description + plan file content when goal is not given", async () => {
    const planFile = path.join(dir, "plan.md");
    await writeFile(planFile, "# Existing plan\n\ndo it like this\n");
    const task = makeTask({ planFile });

    await runCompose({ task, cwd: dir }, makeDeps(ws));

    const goal = (await loadState(ws))?.goal ?? "";
    expect(goal).toContain("Add retry");
    expect(goal).toContain("wrap pick() in a retry loop");
    expect(goal).toContain("do it like this");
  });

  it("taskGoal resolves the plan file when readable and skips it otherwise", async () => {
    const planFile = path.join(dir, "plan.md");
    await writeFile(planFile, "plan body");
    expect(await taskGoal(makeTask({ planFile }))).toContain("plan body");
    expect(await taskGoal(makeTask({ planFile: path.join(dir, "missing.md") }))).not.toContain("plan body");
  });

  it("throws when neither goal nor task is given", async () => {
    await expect(runCompose({ cwd: dir }, makeDeps(ws))).rejects.toThrow(/goal|task/i);
  });

  it("prefers an explicit goal over the task text", async () => {
    await runCompose({ goal: "explicit goal", task: makeTask(), cwd: dir }, makeDeps(ws));
    expect((await loadState(ws))?.goal).toBe("explicit goal");
  });
});
