import { promises as fs } from "fs";
import path from "path";
import type { DiscussEntry } from "../notify/types";
import { loadRuns } from "../run-store";
import { parseVerdict, pendingItems, setChecked } from "./md-state";
import { buildBrainPrompt, buildCheckPrompt, buildImplementPrompt, buildPlanPrompt } from "./prompts";
import { type ComposePhase, type ComposeState, createState, DEFAULT_MAX_NODES, loadState, saveState } from "./state";
import { type ComposeTask, type TaskSource, taskGoal } from "./task-source";
import { CONTEXT_FILE, type ComposeWorkspace, PLAN_FILE, VERDICT_FILE } from "./workspace";

export interface CommandResult {
  code: number;
  output: string;
}

export interface WaitRunOptions {
  /** Called for each unanswered discuss question; return text to answer it. */
  onQuestion(q: DiscussEntry): Promise<string | undefined>;
}

export interface ComposeDeps {
  workspace: ComposeWorkspace;
  /** `at` state dir: run-store polling + discuss threads live here. */
  stateDir: string;
  /** Detached start: returns the child runId (parsed from the `at` report). */
  startAt(tier: number, prompt: string, cwd: string): Promise<{ runId: string }>;
  /** Poll a run until done/failed, answering discuss questions along the way. */
  waitRun(runId: string, opts: WaitRunOptions): Promise<CommandResult>;
  /** Blocking tier-1 call that answers one question (first line of output). */
  askBrain(prompt: string): Promise<string>;
  runCmd(cmd: string, cwd: string): Promise<CommandResult>;
  codegraph(goal: string, maxNodes: number): Promise<string>;
  /** Optional log sink for non-fatal warnings (e.g. task-source hook errors). */
  log?(msg: string): void;
}

export interface ComposeOptions {
  /** Goal text; derived from `task` when omitted. One of the two is required. */
  goal?: string;
  cwd?: string;
  testCmd?: string;
  maxRounds?: number;
  maxNodes?: number;
  /** Max brain answers per agent run (default 5). */
  maxQuestions?: number;
  /** The claimed task being composed (paired with `source`). */
  task?: ComposeTask;
  /** Hook surface for external task queues; hook errors never abort the run. */
  source?: TaskSource;
}

export interface ComposeResult {
  state: ComposePhase;
  round: number;
  goalDir: string;
}

export class ComposeError extends Error {
  constructor(
    readonly phase: ComposePhase,
    detail: string,
  ) {
    super(`compose ${phase}: ${detail}`);
    this.name = "ComposeError";
  }
}

interface Ctx {
  deps: ComposeDeps;
  cwd: string;
  maxNodes: number;
  maxQuestions: number;
  state: ComposeState;
}

const MAX_TEST_OUTPUT = 4000;
const MAX_DIFF = 8000;
const MAX_AGENT_ERROR = 500;
const DEFAULT_MAX_QUESTIONS = 5;

function isTerminal(phase: ComposePhase): boolean {
  return phase === "DONE" || phase === "FAILED";
}

function tail(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `…[truncated ${text.length - maxChars} chars]…\n${text.slice(-maxChars)}`;
}

async function hasCodegraphIndex(cwd: string): Promise<boolean> {
  try {
    await fs.access(path.join(cwd, ".codegraph"));
    return true;
  } catch {
    return false;
  }
}

/** Persist the state we are stuck in, then report it. */
async function fail(ctx: Ctx, phase: ComposePhase, detail: string): Promise<never> {
  await saveState(ctx.deps.workspace, ctx.state);
  throw new ComposeError(phase, detail);
}

function isRunInFlight(ctx: Ctx, runId: string): boolean {
  return loadRuns(ctx.deps.stateDir).find((r) => r.runId === runId)?.status === "running";
}

/**
 * Brain answer policy: forward goal + plan + question to a short tier-1 call.
 * First line of the brain output is the answer. Beyond the per-run cap, or on
 * brain failure, return undefined so the asker's --default/timeout applies.
 */
async function answerQuestion(ctx: Ctx, counter: { count: number }, q: DiscussEntry): Promise<string | undefined> {
  if (counter.count >= ctx.maxQuestions) return undefined;
  counter.count++;
  try {
    const plan = (await ctx.deps.workspace.exists(PLAN_FILE)) ? await ctx.deps.workspace.read(PLAN_FILE) : "";
    const out = await ctx.deps.askBrain(
      buildBrainPrompt({ goal: ctx.state.goal, plan, question: q.text, options: q.options }),
    );
    return out
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l.length > 0);
  } catch {
    return undefined;
  }
}

/** startAt + waitRun so phase callers stay simple. */
async function runAgent(ctx: Ctx, phase: ComposePhase, tier: number, prompt: string): Promise<void> {
  const { runId } = await ctx.deps.startAt(tier, prompt, ctx.cwd);
  const answers = { count: 0 };
  const res = await ctx.deps.waitRun(runId, { onQuestion: (q) => answerQuestion(ctx, answers, q) });
  if (res.code !== 0) {
    await fail(ctx, phase, `tier ${tier} agent exited ${res.code}: ${tail(res.output, MAX_AGENT_ERROR)}`);
  }
}

async function readArtifact(ctx: Ctx, name: string, phase: ComposePhase): Promise<string> {
  const ws = ctx.deps.workspace;
  if (!(await ws.exists(name))) await fail(ctx, phase, `missing ${name} in ${ws.goalDir}`);
  return ws.read(name);
}

async function investigate(ctx: Ctx): Promise<void> {
  if (!(await hasCodegraphIndex(ctx.cwd))) await ctx.deps.runCmd("at index init", ctx.cwd);
  await ctx.deps.runCmd("at index sync", ctx.cwd);
  const context = await ctx.deps.codegraph(ctx.state.goal, ctx.maxNodes);
  await ctx.deps.workspace.write(CONTEXT_FILE, context);
}

async function plan(ctx: Ctx): Promise<void> {
  const ws = ctx.deps.workspace;
  const context = (await ws.exists(CONTEXT_FILE)) ? await ws.read(CONTEXT_FILE) : "";
  const isReplan = ctx.state.round > 1;
  const findings = isReplan && (await ws.exists(VERDICT_FILE)) ? await ws.read(VERDICT_FILE) : undefined;

  await runAgent(
    ctx,
    "PLAN",
    1,
    buildPlanPrompt({ goal: ctx.state.goal, context, workspaceDir: ws.goalDir, findings }),
  );
  if (!(await ws.hasPlan())) await fail(ctx, "PLAN", `missing ${PLAN_FILE} in ${ws.goalDir}`);
}

async function implement(ctx: Ctx): Promise<void> {
  const ws = ctx.deps.workspace;
  let planMd = await readArtifact(ctx, PLAN_FILE, "IMPLEMENT");

  for (const item of pendingItems(planMd)) {
    const prompt = buildImplementPrompt({
      goal: ctx.state.goal,
      task: item.text,
      plan: planMd,
      workspaceDir: ws.goalDir,
    });
    await runItemAgent(ctx, item.index, prompt);
    planMd = await readArtifact(ctx, PLAN_FILE, "IMPLEMENT");
    await ws.write(PLAN_FILE, setChecked(planMd, item.index, true));
  }
}

/**
 * Start (or reattach to) the tier-2 agent for one checklist item. The runId is
 * persisted into state.json BEFORE the agent starts, so a crashed compose can
 * resume by waiting on the in-flight run instead of spawning a duplicate.
 */
async function runItemAgent(ctx: Ctx, itemIndex: number, prompt: string): Promise<void> {
  const ws = ctx.deps.workspace;
  const saved = (ctx.state.runs ?? []).find(
    (r) => r.phase === "IMPLEMENT" && r.item === itemIndex && isRunInFlight(ctx, r.runId),
  );

  let runId: string;
  if (saved) {
    runId = saved.runId;
  } else {
    runId = (await ctx.deps.startAt(2, prompt, ctx.cwd)).runId;
    ctx.state = { ...ctx.state, runs: [...(ctx.state.runs ?? []), { phase: "IMPLEMENT", item: itemIndex, runId }] };
    await saveState(ws, ctx.state);
  }

  const answers = { count: 0 };
  const res = await ctx.deps.waitRun(runId, { onQuestion: (q) => answerQuestion(ctx, answers, q) });
  if (res.code !== 0) {
    await fail(ctx, "IMPLEMENT", `tier 2 agent exited ${res.code}: ${tail(res.output, MAX_AGENT_ERROR)}`);
  }

  const remaining = (ctx.state.runs ?? []).filter((r) => r.runId !== runId);
  ctx.state = { ...ctx.state, runs: remaining.length > 0 ? remaining : undefined };
  await saveState(ws, ctx.state);
}

async function check(ctx: Ctx): Promise<ComposeState> {
  const ws = ctx.deps.workspace;
  const { state } = ctx;
  const planMd = await readArtifact(ctx, PLAN_FILE, "CHECK");
  await ws.remove(VERDICT_FILE);

  const test = await ctx.deps.runCmd(state.testCmd, ctx.cwd);
  const diff = await ctx.deps.runCmd("git diff", ctx.cwd);

  await runAgent(
    ctx,
    "CHECK",
    1,
    buildCheckPrompt({
      goal: state.goal,
      plan: planMd,
      testCmd: state.testCmd,
      testExitCode: test.code,
      testOutput: tail(test.output, MAX_TEST_OUTPUT),
      diff: tail(diff.output, MAX_DIFF),
      workspaceDir: ws.goalDir,
    }),
  );

  let verdict = parseVerdict(await readArtifact(ctx, VERDICT_FILE, "CHECK"));
  if (test.code !== 0 && verdict === "PASS") {
    // Enforce the check rule in code: a PASS verdict cannot stand on failing tests.
    // Rewrite the first line so the re-plan prompt does not see a contradictory PASS.
    const lines = (await ws.read(VERDICT_FILE)).split("\n");
    const firstLine = lines.findIndex((l) => l.replace(/^[\s#>*-]+/, "").trim().length > 0);
    if (firstLine >= 0) lines[firstLine] = "FAIL";
    await ws.write(
      VERDICT_FILE,
      `${lines.join("\n")}\n\n- tests failing (exit code ${test.code}) — verdict forced to FAIL by orchestrator\n`,
    );
    verdict = "FAIL";
  }
  if (verdict === "PASS") return { ...state, state: "DONE" };
  if (state.round >= state.maxRounds) return { ...state, state: "FAILED" };
  return { ...state, state: "PLAN", round: state.round + 1 };
}

/**
 * Fixed transition loop: INVESTIGATE → PLAN → IMPLEMENT → CHECK → DONE|FAILED.
 * A FAIL verdict under maxRounds loops back to PLAN with the findings attached.
 */
export async function runCompose(opts: ComposeOptions, deps: ComposeDeps): Promise<ComposeResult> {
  const ws = deps.workspace;
  await ws.ensure();
  const saved = await loadState(ws);
  const goal = opts.goal ?? (opts.task ? await taskGoal(opts.task) : undefined);
  if (!goal) throw new Error("compose: either goal or task is required");
  const ctx: Ctx = {
    deps,
    cwd: opts.cwd ?? process.cwd(),
    maxNodes: opts.maxNodes ?? DEFAULT_MAX_NODES,
    maxQuestions: opts.maxQuestions ?? DEFAULT_MAX_QUESTIONS,
    state: saved ?? createState(goal, { testCmd: opts.testCmd, maxRounds: opts.maxRounds }),
  };

  const { task, source } = opts;
  const log = deps.log ?? (() => {});
  /** Task-source hooks are best-effort: log and continue, never abort the run. */
  const fire = async (fn: () => Promise<void>): Promise<void> => {
    if (!task || !source) return;
    try {
      await fn();
    } catch (err) {
      log(`[compose] task-source hook error: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  let finished = false;
  const advance = async (next: ComposePhase, round = ctx.state.round): Promise<void> => {
    ctx.state = { ...ctx.state, state: next, round };
    await saveState(ws, ctx.state);
    await fire(async () => {
      await source!.onPhase?.(task!, next, round);
    });
  };
  const result = (): ComposeResult => ({
    state: ctx.state.state,
    round: ctx.state.round,
    goalDir: ws.goalDir,
  });
  const finish = async (): Promise<ComposeResult> => {
    if (!finished) {
      finished = true;
      const state = ctx.state.state;
      if (isTerminal(state)) {
        await fire(() =>
          source!.onFinish(task!, state as "DONE" | "FAILED", { goalDir: ws.goalDir, round: ctx.state.round }),
        );
      }
    }
    return result();
  };

  for (;;) {
    switch (ctx.state.state) {
      case "INVESTIGATE":
        await investigate(ctx);
        await advance("PLAN");
        break;
      case "PLAN":
        await plan(ctx);
        await advance("IMPLEMENT");
        break;
      case "IMPLEMENT":
        await implement(ctx);
        await advance("CHECK");
        break;
      case "CHECK": {
        const next = await check(ctx);
        await advance(next.state, next.round);
        break;
      }
      default:
        return finish();
    }
    if (isTerminal(ctx.state.state)) return finish();
  }
}
