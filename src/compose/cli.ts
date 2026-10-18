import { exec as _exec, execFile as _execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { promisify } from "node:util";
import type { Command } from "commander";
import { getCodegraphContext } from "../commands/codegraph";
import { postDiscussEntry } from "../commands/discuss-helpers";
import { discussEnabled } from "../discuss-flag";
import { resolveBoardFile } from "../kanban/board";
import { unansweredQuestions } from "../notify/discuss-store";
import { loadRuns } from "../run-store";
import { resolveStateDir } from "../state-dir";
import { recordRunForTask } from "../usage/task-metrics";
import { buildJobArgs, defaultJobName, listJobs, readJob, startJob, stopJob, tailLog } from "./background";
import { createKanbanSource } from "./kanban-source";
import { type CommandResult, type ComposeDeps, runCompose } from "./machine";
import { DEFAULT_MAX_NODES, DEFAULT_MAX_ROUNDS, DEFAULT_TEST_CMD, loadState } from "./state";
import { type ComposeTask, type TaskFinishInfo, type TaskSource, taskGoal } from "./task-source";
import { ComposeWorkspace } from "./workspace";
import { ensureTaskWorktree, type MergeRunner, mainCheckout, mergeWorktree, type TaskWorktree } from "./worktree";

const execAsync = promisify(_exec);
const execFileAsync = promisify(_execFile);
const MAX_BUFFER = 32 * 1024 * 1024;
const WAIT_POLL_MS = 2000;
const MAX_LOG_TAIL = 4000;

export interface ComposeCliOptions {
  goal: string;
  goalId: string;
  testCmd: string;
  maxRounds: number;
  maxNodes: number;
  maxQuestions: number;
  /** Opt-in tier-1 PLAN + CHECK around the tier-2 implementer (flag or AT_PLAN_THEN_DO). */
  planThenDo?: boolean;
  /** EXPERIMENTAL: implementers may ask the brain via `at discuss` (plan-then-do only; flag or AT_DISCUSS). */
  discuss?: boolean;
  /** Tier of the single implementer (default 2). */
  tier?: number;
  /** Run the single implementer on this agent, overriding --tier. Ignored in plan-then-do mode. */
  agent?: string;
  /** Codegraph keywords for INVESTIGATE (merged with plan-file keywords). */
  keywords?: string[];
  /** Working directory for the run (task worktree under --worktree); default process.cwd(). */
  cwd?: string;
  /** Set when composing a kanban task (goal text is derived from it). */
  task?: ComposeTask;
  /** Kanban source: machine fires onPhase/onFinish against the board. */
  source?: TaskSource;
}

export interface ComposeCliDeps {
  run?(opts: ComposeCliOptions): Promise<number>;
  log?(msg: string): void;
  error?(msg: string): void;
  newGoalId?(): string;
}

interface ComposeCliArgs {
  prompt?: string;
  goal?: string;
  task?: string;
  board?: string;
  loop?: boolean;
  stopOnFail?: boolean;
  testCmd: string;
  maxRounds: number;
  maxNodes: number;
  maxQuestions: number;
  resume?: string;
  planThenDo?: boolean;
  discuss?: boolean;
  tier?: number;
  agent?: string;
  keywords?: string;
  worktree?: boolean;
  merge?: boolean;
  background?: boolean;
  name?: string;
  follow?: string | boolean;
  maxTasks?: number;
}

/** `AT_PLAN_THEN_DO=1|true|yes|on` enables plan-then-do mode without the flag. */
/** Experimental discuss channel: `--discuss` or `AT_DISCUSS=1`. Only takes effect with plan-then-do mode. */
export function discussOptIn(flag: boolean | undefined, env: NodeJS.ProcessEnv = process.env): boolean {
  return flag === true || discussEnabled(env);
}

export function planThenDoEnabled(flag: boolean | undefined, env: NodeJS.ProcessEnv = process.env): boolean {
  return flag === true || /^(1|true|yes|on)$/i.test((env.AT_PLAN_THEN_DO ?? "").trim());
}

function parseKeywords(raw: string | undefined): string[] | undefined {
  const kw = (raw ?? "")
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);
  return kw.length > 0 ? kw : undefined;
}

const DEFAULT_FOLLOW_S = 60;

/** `--follow` → 60s, `--follow 30` → 30s; unset → no follow. */
export function followMsFrom(raw: string | boolean | undefined): number | undefined {
  if (raw === undefined || raw === false) return undefined;
  const n = raw === true ? DEFAULT_FOLLOW_S : Number(raw);
  return Number.isFinite(n) && n > 0 ? n * 1000 : DEFAULT_FOLLOW_S * 1000;
}

/**
 * First Ctrl-C / SIGTERM ends the loop after the in-flight task (resumable via state.json);
 * the second one exits immediately.
 */
function abortOnSignal(): AbortSignal {
  const ac = new AbortController();
  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    process.on(sig, () => {
      if (ac.signal.aborted) process.exit(130);
      ac.abort();
    });
  }
  return ac.signal;
}

export interface BoardTasksOptions {
  board?: string;
  /** Compose one specific kanban task by id. */
  taskId?: string;
  /** Keep claiming + composing until the board has no executable task. */
  loop: boolean;
  /** Stop the loop after the first FAILED run (default: FAILED → Blocked, loop continues). */
  stopOnFail: boolean;
  /** Run each task in its own worktree (`<repo>-<id>` on `feat/<id>`) instead of the current checkout. */
  worktree?: boolean;
  /** With worktree: after a DONE run, rebase + ff-merge + clean up via scripts/merge-worktree.sh. */
  merge?: boolean;
  /** With loop: when the board is drained, sleep this many ms and poll again (until max-tasks / SIGINT). */
  followMs?: number;
  /** Stop after composing this many tasks (guards an unattended loop / follow). */
  maxTasks?: number;
  runOne: (opts: ComposeCliOptions) => Promise<number>;
  log: (msg: string) => void;
  /** Test seams. */
  sleep?: (ms: number) => Promise<void>;
  prepareWorktree?: (taskId: string) => Promise<TaskWorktree>;
  mergeRunner?: MergeRunner;
  signal?: AbortSignal;
  /** Test seam: where per-goal compose state lives. Defaults to ~/.at/compose. */
  workspaceFor?: (goalId: string) => ComposeWorkspace;
}

function isTerminalPhase(state: string | undefined): state is "DONE" | "FAILED" {
  return state === "DONE" || state === "FAILED";
}

/**
 * Drive compose from a kanban board: claim a task (goalId = lowercase task id,
 * so state.json under ~/.at/compose/<id>/ makes --resume implicit), compose it,
 * repeat while `loop`. Exit code: 0 when no task FAILED, else 1.
 */
export async function runBoardTasks(
  params: Pick<
    ComposeCliOptions,
    "testCmd" | "maxRounds" | "maxNodes" | "maxQuestions" | "planThenDo" | "discuss" | "tier" | "agent" | "keywords"
  >,
  opts: BoardTasksOptions,
): Promise<number> {
  const workspaceFor = opts.workspaceFor ?? ((id: string) => new ComposeWorkspace(id));
  const source = createKanbanSource({ boardFile: resolveBoardFile(opts.board), log: opts.log });
  const finish = async (task: ComposeTask, outcome: "DONE" | "FAILED", info: TaskFinishInfo): Promise<void> => {
    try {
      await source.onFinish(task, outcome, info);
    } catch (err) {
      opts.log(`[compose] onFinish error for ${task.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const sleep =
    opts.sleep ??
    ((ms: number) =>
      new Promise<void>((resolve) => {
        const t = setTimeout(resolve, ms);
        opts.signal?.addEventListener(
          "abort",
          () => {
            clearTimeout(t);
            resolve();
          },
          { once: true },
        );
      }));
  const prepare = opts.prepareWorktree ?? ((id: string) => ensureTaskWorktree(process.cwd(), id));
  const merger = opts.mergeRunner ?? mergeWorktree;
  const follow = opts.loop && !opts.taskId && (opts.followMs ?? 0) > 0;

  let anyFailed = false;
  let claimedSpecific = false;
  let done = 0;
  for (;;) {
    if (opts.signal?.aborted) break;
    if (opts.maxTasks !== undefined && done >= opts.maxTasks) break;
    let task: Awaited<ReturnType<typeof source.claim>>;
    if (opts.taskId) {
      if (claimedSpecific) {
        task = null;
      } else {
        claimedSpecific = true;
        task = await source.claimId(opts.taskId);
      }
    } else {
      task = await source.claim();
    }
    if (!task) {
      if (opts.taskId) return 1; // explicitly requested task not found
      if (!follow) break;
      await sleep(opts.followMs as number); // drained: poll the board again
      continue;
    }
    done++;

    const goalId = task.id.toLowerCase();
    const ws = workspaceFor(goalId);
    const saved = await loadState(ws);
    if (saved && isTerminalPhase(saved.state)) {
      await finish(task, saved.state, { goalDir: ws.goalDir, round: saved.round });
      if (saved.state === "FAILED") anyFailed = true;
      if (saved.state === "FAILED" && opts.stopOnFail) break;
      if (!opts.loop || opts.taskId) break;
      continue;
    }

    const goal = await taskGoal(task);
    let wt: TaskWorktree | undefined;
    if (opts.worktree) {
      try {
        wt = await prepare(task.id);
        opts.log(`[compose] ${task.id} worktree ${wt.path} (${wt.branch})`);
      } catch (err) {
        // No isolation = no run: composing in the shared checkout would defeat the flag.
        opts.log(`[compose] worktree for ${task.id} failed: ${err instanceof Error ? err.message : String(err)}`);
        await finish(task, "FAILED", { goalDir: ws.goalDir, round: 0 });
        anyFailed = true;
        if (opts.stopOnFail) break;
        if (!opts.loop || opts.taskId) break;
        continue;
      }
    }
    const code = await opts.runOne({ goal, goalId, task, source, cwd: wt?.path, ...params });
    if (code !== 0) {
      anyFailed = true;
      if (opts.stopOnFail) break;
    } else if (wt && opts.merge) {
      const merged = await merger(wt, await mainCheckout(process.cwd()));
      opts.log(
        `[compose] merge ${wt.branch}: ${merged.ok ? "MERGED" : "FAILED"} ${merged.ok ? "" : merged.output}`.trim(),
      );
      if (!merged.ok) {
        // Work is done and committed in the worktree; leave it for a human, do not loop on top of an unmerged base.
        anyFailed = true;
        break;
      }
    }
    if (!opts.loop || opts.taskId) break;
  }
  return anyFailed ? 1 : 0;
}

function failure(err: unknown): CommandResult {
  const e = err as { code?: unknown; stdout?: string; stderr?: string; message?: string };
  const code = typeof e.code === "number" ? e.code : 1;
  return { code, output: `${e.stdout ?? ""}${e.stderr ?? e.message ?? ""}` };
}

/** Real deps: shell out to `at` for agent calls, to a shell for local commands. */
export function createComposeDeps(workspace: ComposeWorkspace, stateDir = resolveStateDir()): ComposeDeps {
  return {
    workspace,
    stateDir,
    async startAt(tier, prompt, cwd, opts) {
      // Detached start (no -s): `at` prints the run box and returns immediately.
      // A pinned agent replaces the tier selection: `at` round-robins within the tier otherwise.
      const args = opts?.agent
        ? ["-a", opts.agent, "--state-dir", stateDir, "-p", prompt]
        : ["-t", String(tier), "--state-dir", stateDir, "-p", prompt];
      const { stdout } = await execFileAsync("at", args, {
        cwd,
        maxBuffer: MAX_BUFFER,
        // Explicit either way: a stray AT_DISCUSS in the parent env must not leak into non-discuss runs.
        env: { ...process.env, AT_DISCUSS: opts?.discuss ? "1" : "0" },
      });
      const m = /Run ID:\s*(\S+)/.exec(stdout);
      if (!m) throw new Error(`compose: could not parse Run ID from at output: ${stdout.slice(0, 200)}`);
      return { runId: m[1] };
    },
    async waitRun(runId, { onQuestion }) {
      const attempted = new Set<string>();
      for (;;) {
        for (const q of unansweredQuestions(stateDir, runId)) {
          if (attempted.has(q.id)) continue;
          attempted.add(q.id);
          const answer = await onQuestion(q);
          if (answer?.trim()) {
            await postDiscussEntry(
              runId,
              { from: "host", kind: "answer", text: answer.trim(), replyTo: q.id },
              stateDir,
            );
          }
        }
        const rec = loadRuns(stateDir).find((r) => r.runId === runId);
        if (rec && rec.status !== "running") {
          // A detached run's real exit code is unknowable: done → 0, failed/stuck → 1.
          const code = rec.status === "done" ? (rec.exitCode ?? 0) : (rec.exitCode ?? 1);
          return { code, output: logTail(rec.logFile) };
        }
        await new Promise((r) => setTimeout(r, WAIT_POLL_MS));
      }
    },
    async recordRun(runId, taskId) {
      await recordRunForTask(stateDir, runId, taskId);
    },
    async askBrain(prompt) {
      const { stdout, stderr } = await execFileAsync("at", ["-t", "1", "--state-dir", stateDir, "-s", "-p", prompt], {
        maxBuffer: MAX_BUFFER,
      });
      return `${stdout}${stderr}`;
    },
    async runCmd(cmd, cwd) {
      try {
        const { stdout, stderr } = await execAsync(cmd, { cwd, maxBuffer: MAX_BUFFER });
        return { code: 0, output: `${stdout}${stderr}` };
      } catch (err) {
        return failure(err);
      }
    },
    codegraph: (goal, maxNodes) => getCodegraphContext(goal, maxNodes),
  };
}

function logTail(logFile: string): string {
  try {
    const content = readFileSync(logFile, "utf8");
    return content.length > MAX_LOG_TAIL ? content.slice(-MAX_LOG_TAIL) : content;
  } catch {
    return "";
  }
}

export function registerComposeCommand(program: Command, deps: ComposeCliDeps = {}): void {
  const log = deps.log ?? ((msg: string) => console.log(msg));
  const error = deps.error ?? ((msg: string) => console.error(msg));
  const newGoalId = deps.newGoalId ?? (() => crypto.randomUUID());
  const run =
    deps.run ??
    (async (opts: ComposeCliOptions) => {
      const workspace = new ComposeWorkspace(opts.goalId);
      const result = await runCompose(
        {
          goal: opts.goal,
          task: opts.task,
          source: opts.source,
          testCmd: opts.testCmd,
          maxRounds: opts.maxRounds,
          maxNodes: opts.maxNodes,
          maxQuestions: opts.maxQuestions,
          planThenDo: opts.planThenDo,
          discuss: opts.discuss,
          tier: opts.tier,
          agent: opts.agent,
          keywords: opts.keywords,
          cwd: opts.cwd ?? process.cwd(),
        },
        createComposeDeps(workspace),
      );
      log(`[compose] ${result.state} after round ${result.round} — artifacts in ${result.goalDir}`);
      return result.state === "DONE" ? 0 : 1;
    });

  const compose = program
    .command("compose")
    .description(
      "Goal runner: one tier-2 implementer + test gate (default); --plan-then-do / AT_PLAN_THEN_DO=1 adds tier-1 plan + check",
    )
    .option("-p, --prompt <text>", "Goal prompt")
    .option("--goal <text>", "Alias for --prompt")
    .option("--test-cmd <cmd>", "Test command run during CHECK", DEFAULT_TEST_CMD)
    .option("--max-rounds <number>", "Re-plan rounds before FAILED", (v) => parseInt(v, 10), DEFAULT_MAX_ROUNDS)
    .option("--max-nodes <number>", "Max codegraph nodes in PLAN context", (v) => parseInt(v, 10), DEFAULT_MAX_NODES)
    .option("--max-questions <number>", "Max brain answers per agent run during IMPLEMENT", (v) => parseInt(v, 10), 5)
    .option(
      "--plan-then-do",
      "Opt in to tier-1 PLAN + CHECK around the implementer (3+ agent runs; also AT_PLAN_THEN_DO=1)",
      false,
    )
    .option(
      "--discuss",
      "EXPERIMENTAL: with --plan-then-do, let implementers ask the tier-1 brain via `at discuss` (also AT_DISCUSS=1)",
      false,
    )
    .option("--tier <number>", "Tier of the single implementer (default 2)", (v) => parseInt(v, 10))
    .option("-a, --agent <name>", "Run the single implementer on this agent (overrides --tier)")
    .option("--keywords <list>", "Comma-separated codegraph keywords for INVESTIGATE (plan-file keywords are merged)")
    .option("--resume <id>", "Resume a saved goal by id (continues from state.json)")
    .option("--task <id>", "Compose one kanban task by id (claims and marks it In Progress)")
    .option("--loop", "Claim and compose board tasks until none are executable", false)
    .option("--board <file>", "Kanban board file for --task/--loop (default: resolved project board)")
    .option("--stop-on-fail", "With --loop: stop after the first FAILED run", false)
    .option("--worktree", "With --task/--loop: run each task in its own worktree <repo>-<id> on feat/<id>", false)
    .option("--merge", "With --worktree: after a DONE run, rebase + ff-merge into main and clean up", false)
    .option("--follow [seconds]", "With --loop: keep polling the board when drained (default every 60s)")
    .option("--max-tasks <number>", "With --loop: stop after composing this many tasks", (v) => parseInt(v, 10))
    .option("--background", "With --task/--loop: run detached (`at compose jobs|logs|stop` manage it)", false)
    .option("--name <name>", "With --background: job name (default: task id, else 'loop')")
    .action(async (args: ComposeCliArgs) => {
      const prompt = args.prompt ?? args.goal;
      if ((args.worktree || args.merge || args.follow || args.maxTasks) && !(args.task || args.loop)) {
        error("[compose] Error: --worktree/--merge/--follow/--max-tasks need --task or --loop");
        process.exit(1);
        return;
      }
      if (args.merge && !args.worktree) {
        error("[compose] Error: --merge requires --worktree");
        process.exit(1);
        return;
      }
      if (args.follow && !args.loop) {
        error("[compose] Error: --follow requires --loop");
        process.exit(1);
        return;
      }
      if ((args.background || args.name) && !(args.task || args.loop)) {
        error("[compose] Error: --background/--name need --task or --loop");
        process.exit(1);
        return;
      }
      if (args.name && !args.background) {
        error("[compose] Error: --name requires --background");
        process.exit(1);
        return;
      }
      if (args.background) {
        try {
          const stateDir = resolveStateDir();
          const job = startJob({
            stateDir,
            name: args.name ?? defaultJobName(args.task),
            args: buildJobArgs(process.argv.slice(2)),
            cwd: process.cwd(),
          });
          log(`[compose] job ${job.name} started (pid ${job.pid}) — log ${job.logFile}`);
          log("[compose] manage: at compose jobs | at compose logs " + job.name + " | at compose stop " + job.name);
          process.exit(0);
        } catch (err) {
          error(`[compose] ${err instanceof Error ? err.message : String(err)}`);
          process.exit(1);
        }
        return;
      }
      if (args.task || args.loop) {
        if (prompt) {
          error("[compose] Error: --prompt/--goal cannot be combined with --task/--loop");
          process.exit(1);
          return;
        }
        try {
          process.exit(
            await runBoardTasks(
              {
                testCmd: args.testCmd,
                maxRounds: args.maxRounds,
                maxNodes: args.maxNodes,
                maxQuestions: args.maxQuestions,
                planThenDo: planThenDoEnabled(args.planThenDo),
                discuss: discussOptIn(args.discuss),
                tier: args.tier,
                agent: args.agent,
                keywords: parseKeywords(args.keywords),
              },
              {
                board: args.board,
                taskId: args.task,
                loop: args.loop ?? false,
                stopOnFail: args.stopOnFail ?? false,
                worktree: args.worktree ?? false,
                merge: args.merge ?? false,
                followMs: followMsFrom(args.follow),
                maxTasks: args.maxTasks,
                signal: abortOnSignal(),
                runOne: run,
                log,
              },
            ),
          );
        } catch (err) {
          error(`[compose] ${err instanceof Error ? err.message : String(err)}`);
          process.exit(1);
        }
        return;
      }
      if (!prompt) {
        error("[compose] Error: --prompt or --goal is required (or use --task/--loop with a board)");
        process.exit(1);
        return;
      }

      const goalId = args.resume ?? newGoalId();
      log(`[compose] goal ${goalId}`);

      try {
        process.exit(
          await run({
            goal: prompt,
            goalId,
            testCmd: args.testCmd,
            maxRounds: args.maxRounds,
            maxNodes: args.maxNodes,
            maxQuestions: args.maxQuestions,
            planThenDo: planThenDoEnabled(args.planThenDo),
            discuss: discussOptIn(args.discuss),
            tier: args.tier,
            agent: args.agent,
            keywords: parseKeywords(args.keywords),
          }),
        );
      } catch (err) {
        error(`[compose] ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }
    });

  compose
    .command("jobs")
    .description("List background compose jobs (--background)")
    .action(() => {
      const jobs = listJobs(resolveStateDir());
      if (jobs.length === 0) log("[compose] no background jobs");
      for (const j of jobs) log(`${j.name}\t${j.alive ? "running" : "exited"}\tpid ${j.pid}\t${j.startedAt}\t${j.cwd}`);
    });

  compose
    .command("logs <name>")
    .description("Tail a background job's log")
    .option("-n, --lines <number>", "Lines to show", (v) => parseInt(v, 10), 40)
    .action((name: string, o: { lines: number }) => {
      const job = readJob(resolveStateDir(), name);
      if (!job) {
        error(`[compose] job not found: ${name}`);
        process.exit(1);
        return;
      }
      log(tailLog(job.logFile, o.lines));
    });

  compose
    .command("stop <name>")
    .description("Stop a background job after its in-flight task (--force: kill now)")
    .option("--force", "SIGKILL instead of finishing the in-flight task", false)
    .action((name: string, o: { force: boolean }) => {
      try {
        const job = stopJob(resolveStateDir(), name, o.force);
        log(
          job.alive
            ? `[compose] ${o.force ? "killed" : "stop requested (finishing in-flight task)"}: ${name} (pid ${job.pid})`
            : `[compose] job ${name} not running`,
        );
      } catch (err) {
        error(`[compose] ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }
    });
}
