import { promises as fs } from "node:fs";
import path from "node:path";
import type { DiscussEntry } from "../notify/types";
import { loadRuns } from "../run-store";
import { parseVerdict, pendingItems, setChecked } from "./md-state";
import {
  buildBrainPrompt,
  buildCheckPrompt,
  buildImplementPrompt,
  buildPlanPrompt,
  buildSingleImplementPrompt,
} from "./prompts";
import {
  type ComposeMode,
  type ComposePhase,
  type ComposeState,
  createState,
  DEFAULT_MAX_NODES,
  loadState,
  saveState,
} from "./state";
import { type ComposeTask, type TaskSource, taskGoal, taskKeywords } from "./task-source";
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
  startAt(
    tier: number,
    prompt: string,
    cwd: string,
    opts?: { discuss?: boolean; agent?: string },
  ): Promise<{ runId: string }>;
  /** Poll a run until done/failed, answering discuss questions along the way. */
  waitRun(runId: string, opts: WaitRunOptions): Promise<CommandResult>;
  /** Blocking tier-1 call that answers one question (first line of output). */
  askBrain(prompt: string): Promise<string>;
  runCmd(cmd: string, cwd: string): Promise<CommandResult>;
  codegraph(goal: string, maxNodes: number): Promise<string>;
  /** Optional: meter a finished run against a kanban task (time + tokens). Best-effort. */
  recordRun?(runId: string, taskId: string): Promise<void>;
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
  /** Opt-in tier-1 PLAN + CHECK around tier-2 hands. Default: one implementer run + test gate. */
  twoAgents?: boolean;
  /** EXPERIMENTAL: let implementer agents ask the tier-1 brain via `at discuss`. Two-agent mode only. */
  discuss?: boolean;
  /** Tier of the single implementer (default 2). Ignored in two-agent mode. */
  tier?: number;
  /** Pin the single implementer to this agent (overrides `tier`). Ignored in two-agent mode. */
  agent?: string;
  /** Extra codegraph keywords; merged with the task's plan-file keywords. */
  keywords?: string[];
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
  discuss: boolean;
  state: ComposeState;
  mode: ComposeMode;
  tier: number;
  /** Pinned agent for the single-mode implementer run; never set in two-agent mode. */
  agent?: string;
  keywords: string[];
  /** Kanban task id when running under `--task`/`--loop`: finished runs are metered against it. */
  taskId?: string;
}

const MAX_TEST_OUTPUT = 4000;
const MAX_DIFF = 8000;
const MAX_AGENT_ERROR = 500;
const DEFAULT_MAX_QUESTIONS = 5;
const DEFAULT_SINGLE_TIER = 2;

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
/** Best-effort: usage metering must never fail or stall a compose run. */
async function meterRun(ctx: Ctx, runId: string): Promise<void> {
  if (!ctx.taskId || !ctx.deps.recordRun) return;
  try {
    await ctx.deps.recordRun(runId, ctx.taskId);
  } catch (err) {
    ctx.deps.log?.(`[compose] usage metering error: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function runAgent(ctx: Ctx, phase: ComposePhase, tier: number, prompt: string): Promise<void> {
  const { runId } = await ctx.deps.startAt(tier, prompt, ctx.cwd, { discuss: ctx.discuss });
  const answers = { count: 0 };
  const res = await ctx.deps.waitRun(runId, { onQuestion: (q) => answerQuestion(ctx, answers, q) });
  await meterRun(ctx, runId);
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
  // Keywords (plan-file labels) are a sharper query than the goal text, which may embed a whole plan.
  const kw = ctx.keywords;
  const context = await ctx.deps.codegraph(kw.length > 0 ? kw.join(" ") : ctx.state.goal, ctx.maxNodes);
  await ctx.deps.workspace.write(CONTEXT_FILE, kw.length > 0 ? `Keywords: ${kw.join(", ")}\n\n${context}` : context);
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
      discuss: ctx.discuss,
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
async function runItemAgent(ctx: Ctx, itemIndex: number, prompt: string, tier = 2, agent?: string): Promise<void> {
  const ws = ctx.deps.workspace;
  const saved = (ctx.state.runs ?? []).find(
    (r) => r.phase === "IMPLEMENT" && r.item === itemIndex && isRunInFlight(ctx, r.runId),
  );

  let runId: string;
  if (saved) {
    runId = saved.runId;
  } else {
    runId = (await ctx.deps.startAt(tier, prompt, ctx.cwd, { discuss: ctx.discuss, agent })).runId;
    ctx.state = { ...ctx.state, runs: [...(ctx.state.runs ?? []), { phase: "IMPLEMENT", item: itemIndex, runId }] };
    await saveState(ws, ctx.state);
  }

  const answers = { count: 0 };
  const res = await ctx.deps.waitRun(runId, { onQuestion: (q) => answerQuestion(ctx, answers, q) });
  await meterRun(ctx, runId);
  if (res.code !== 0) {
    await fail(ctx, "IMPLEMENT", `tier ${tier} agent exited ${res.code}: ${tail(res.output, MAX_AGENT_ERROR)}`);
  }

  const remaining = (ctx.state.runs ?? []).filter((r) => r.runId !== runId);
  ctx.state = { ...ctx.state, runs: remaining.length > 0 ? remaining : undefined };
  await saveState(ws, ctx.state);
}

/** Single mode: the one implementer run. On a fix round the previous test output rides along. */
async function implementSingle(ctx: Ctx): Promise<void> {
  const ws = ctx.deps.workspace;
  const context = (await ws.exists(CONTEXT_FILE)) ? await ws.read(CONTEXT_FILE) : "";
  const findings = ctx.state.round > 1 && (await ws.exists(VERDICT_FILE)) ? await ws.read(VERDICT_FILE) : undefined;
  const prompt = buildSingleImplementPrompt({ goal: ctx.state.goal, context, workspaceDir: ws.goalDir, findings });
  await runItemAgent(ctx, 0, prompt, ctx.tier, ctx.agent);
}

/** Single mode CHECK: no reviewer agent — the test command is the gate. FAIL re-runs the implementer. */
async function checkSingle(ctx: Ctx): Promise<ComposeState> {
  const ws = ctx.deps.workspace;
  const { state } = ctx;
  await ws.remove(VERDICT_FILE);
  const test = await ctx.deps.runCmd(state.testCmd, ctx.cwd);
  if (test.code === 0) return { ...state, state: "DONE" };
  await ws.write(
    VERDICT_FILE,
    `FAIL\n\ncommand: ${state.testCmd}\nexit code: ${test.code}\n\n\`\`\`\n${tail(test.output, MAX_TEST_OUTPUT)}\n\`\`\`\n`,
  );
  if (state.round >= state.maxRounds) return { ...state, state: "FAILED" };
  return { ...state, state: "IMPLEMENT", round: state.round + 1 };
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
 * Single (default): INVESTIGATE → IMPLEMENT (one agent) → CHECK (test gate) → DONE|FAILED;
 * a failing gate under maxRounds loops back to IMPLEMENT with the test output attached.
 * Two-agent (opt-in): INVESTIGATE → PLAN → IMPLEMENT → CHECK → DONE|FAILED;
 * a FAIL verdict under maxRounds loops back to PLAN with the findings attached.
 */
export async function runCompose(opts: ComposeOptions, deps: ComposeDeps): Promise<ComposeResult> {
  const ws = deps.workspace;
  await ws.ensure();
  const saved = await loadState(ws);
  const goal = opts.goal ?? (opts.task ? await taskGoal(opts.task) : undefined);
  if (!goal) throw new Error("compose: either goal or task is required");
  // A saved state keeps its mode (pre-mode states are two-agent); only fresh runs read the option.
  const mode: ComposeMode = saved ? (saved.mode ?? "two") : opts.twoAgents ? "two" : "single";
  const discuss = mode === "two" && opts.discuss === true;
  const keywords = [...new Set([...(opts.keywords ?? []), ...(opts.task ? await taskKeywords(opts.task) : [])])];
  const ctx: Ctx = {
    deps,
    cwd: opts.cwd ?? process.cwd(),
    maxNodes: opts.maxNodes ?? DEFAULT_MAX_NODES,
    // Discuss is experimental, opt-in and two-agent only; otherwise no tier-1 brain call is ever spent.
    discuss,
    maxQuestions: discuss ? (opts.maxQuestions ?? DEFAULT_MAX_QUESTIONS) : 0,
    state: saved ?? createState(goal, { testCmd: opts.testCmd, maxRounds: opts.maxRounds, mode }),
    mode,
    tier: opts.tier ?? DEFAULT_SINGLE_TIER,
    // Agent pinning is a single-mode affordance; the two-agent pipeline owns its own tiers.
    agent: mode === "single" ? opts.agent : undefined,
    keywords,
    taskId: opts.task?.id,
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
        await advance(ctx.mode === "single" ? "IMPLEMENT" : "PLAN");
        break;
      case "PLAN":
        await plan(ctx);
        await advance("IMPLEMENT");
        break;
      case "IMPLEMENT":
        await (ctx.mode === "single" ? implementSingle(ctx) : implement(ctx));
        await advance("CHECK");
        break;
      case "CHECK": {
        const next = await (ctx.mode === "single" ? checkSingle(ctx) : check(ctx));
        await advance(next.state, next.round);
        break;
      }
      default:
        return finish();
    }
    if (isTerminal(ctx.state.state)) return finish();
  }
}
