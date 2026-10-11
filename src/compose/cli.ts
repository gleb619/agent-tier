import { exec as _exec, execFile as _execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { promisify } from "node:util";
import type { Command } from "commander";
import { getCodegraphContext } from "../commands/codegraph";
import { postDiscussEntry } from "../commands/discuss-helpers";
import { unansweredQuestions } from "../notify/discuss-store";
import type { DiscussEntry } from "../notify/types";
import { loadRuns } from "../run-store";
import { resolveStateDir } from "../state-dir";
import { type CommandResult, type ComposeDeps, runCompose } from "./machine";
import { DEFAULT_MAX_NODES, DEFAULT_MAX_ROUNDS, DEFAULT_TEST_CMD } from "./state";
import { ComposeWorkspace } from "./workspace";

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
  testCmd: string;
  maxRounds: number;
  maxNodes: number;
  maxQuestions: number;
  resume?: string;
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
    async startAt(tier, prompt, cwd) {
      // Detached start (no -s): `at` prints the run box and returns immediately.
      const { stdout } = await execFileAsync(
        "at",
        ["-t", String(tier), "--state-dir", stateDir, "-p", prompt],
        { cwd, maxBuffer: MAX_BUFFER },
      );
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
          if (answer && answer.trim()) {
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
    async askBrain(prompt) {
      const { stdout, stderr } = await execFileAsync(
        "at",
        ["-t", "1", "--state-dir", stateDir, "-s", "-p", prompt],
        { maxBuffer: MAX_BUFFER },
      );
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
          testCmd: opts.testCmd,
          maxRounds: opts.maxRounds,
          maxNodes: opts.maxNodes,
          maxQuestions: opts.maxQuestions,
          cwd: process.cwd(),
        },
        createComposeDeps(workspace),
      );
      log(`[compose] ${result.state} after round ${result.round} — artifacts in ${result.goalDir}`);
      return result.state === "DONE" ? 0 : 1;
    });

  program
    .command("compose")
    .description("Plan (tier 1) -> implement (tier 2) -> check (tier 1) state machine for one goal")
    .option("-p, --prompt <text>", "Goal prompt")
    .option("--goal <text>", "Alias for --prompt")
    .option("--test-cmd <cmd>", "Test command run during CHECK", DEFAULT_TEST_CMD)
    .option("--max-rounds <number>", "Re-plan rounds before FAILED", (v) => parseInt(v, 10), DEFAULT_MAX_ROUNDS)
    .option("--max-nodes <number>", "Max codegraph nodes in PLAN context", (v) => parseInt(v, 10), DEFAULT_MAX_NODES)
    .option(
      "--max-questions <number>",
      "Max brain answers per agent run during IMPLEMENT",
      (v) => parseInt(v, 10),
      5,
    )
    .option("--resume <id>", "Resume a saved goal by id (continues from state.json)")
    .action(async (args: ComposeCliArgs) => {
      const prompt = args.prompt ?? args.goal;
      if (!prompt) {
        error("[compose] Error: --prompt or --goal is required");
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
          }),
        );
      } catch (err) {
        error(`[compose] ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }
    });
}
