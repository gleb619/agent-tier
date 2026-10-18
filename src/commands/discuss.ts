import type { Command } from "commander";
import { DISCUSS_DISABLED_MSG, discussEnabled } from "../discuss-flag";
import {
  hostSays,
  latestUnansweredQuestion,
  readThread,
  unansweredQuestions,
  waitForAnswer,
} from "../notify/discuss-store";
import type { DiscussEntry } from "../notify/types";
import { resolveStateDir } from "../state-dir";
import { postDiscussEntry } from "./discuss-helpers";

interface AskOpts {
  options: string[];
  timeout: string;
  default?: string;
  run?: string;
}

function resolveRunId(runId?: string): string {
  const r = runId ?? process.env.AT_RUN_ID;
  if (!r) {
    console.error("[at] discuss: missing runId (pass -R or set AT_RUN_ID)");
    process.exit(2);
  }
  return r;
}

/** Read global options from the subcommand context so inherited flags
 *  (--state-dir, --json, etc.) are not shadowed by ancestor defaults. */
function readGlobals(command: Command): Record<string, unknown> {
  return command.optsWithGlobals();
}

export function registerDiscussCommand(program: Command): void {
  const discuss = program
    .command("discuss")
    .description("[experimental, AT_DISCUSS=1] Agent<->orchestrator channel for compose plan-then-do runs (m2m)")
    .hook("preAction", () => {
      if (!discussEnabled()) {
        console.error(DISCUSS_DISABLED_MSG);
        process.exit(2);
      }
    });

  // ── ask ────────────────────────────────────────────────────────────────────
  discuss
    .command("ask <question>")
    .description("Post a question, block until host answers")
    .option(
      "-o, --options <opt>",
      "Option label (repeat for multi-choice)",
      (v: string, prev: string[]) => prev.concat(v),
      [] as string[],
    )
    .option("--timeout <seconds>", "Seconds to wait (default 300)", "300")
    .option("--default <answer>", "Fallback answer if host does not respond")
    .option("-R, --run <runId>", "Run id (defaults to AT_RUN_ID)")
    .action(async (question: string, opts: AskOpts, command: Command) => {
      const globals = readGlobals(command);
      const runId = resolveRunId(opts.run);
      const stateDir = resolveStateDir(globals.stateDir as string | undefined);
      const id = await postDiscussEntry(
        runId,
        {
          from: "agent",
          kind: "question",
          text: question,
          options: opts.options.length ? opts.options : undefined,
        },
        stateDir,
      );
      const timeoutMs = Number(opts.timeout) * 1000;
      const ans = await waitForAnswer(stateDir, runId, id, timeoutMs, 200);
      if (ans) {
        process.stdout.write(`${ans.text}\n`);
        return;
      }
      if (opts.default !== undefined) {
        // Record the default as a synthetic answer so the question does not
        // appear in `list --pending` after timeout.
        await postDiscussEntry(
          runId,
          {
            from: "host",
            kind: "answer",
            text: opts.default,
            replyTo: id,
          },
          stateDir,
        );
        process.stdout.write(`${opts.default}\n`);
        return;
      }
      console.error(`[at] discuss ask: timeout after ${opts.timeout}s with no answer`);
      process.exit(2);
    });

  // ── note ───────────────────────────────────────────────────────────────────
  discuss
    .command("note <text>")
    .description("Post a one-way progress note (mirrors as SSE message)")
    .option("-R, --run <runId>", "Run id (defaults to AT_RUN_ID)")
    .action(async (text: string, opts: { run?: string }, command: Command) => {
      const globals = readGlobals(command);
      const runId = resolveRunId(opts.run);
      const stateDir = resolveStateDir(globals.stateDir as string | undefined);
      await postDiscussEntry(runId, { from: "agent", kind: "note", text }, stateDir);
    });

  // ── inbox ──────────────────────────────────────────────────────────────────
  discuss
    .command("inbox")
    .description('Print host instructions ("say" messages); with --wait polls for more')
    .option("--wait <seconds>", "Keep waiting up to N seconds for new messages", "0")
    .option("--since <id>", "Only return messages after this entry id")
    .option("-R, --run <runId>", "Run id (defaults to AT_RUN_ID)")
    .action(async (opts: { wait: string; since?: string; run?: string }, command: Command) => {
      const globals = readGlobals(command);
      const runId = resolveRunId(opts.run);
      const stateDir = resolveStateDir(globals.stateDir as string | undefined);
      const waitMs = Number(opts.wait) * 1000;
      const deadline = Date.now() + waitMs;
      let lastId = opts.since;
      // Initial dump
      for (const e of hostSays(stateDir, runId, lastId)) {
        process.stdout.write(`${e.id}\t${e.text}\n`);
        lastId = e.id;
      }
      while (Date.now() < deadline) {
        const remaining = deadline - Date.now();
        if (remaining <= 0) break;
        await new Promise((r) => setTimeout(r, Math.min(500, remaining)));
        for (const e of hostSays(stateDir, runId, lastId)) {
          process.stdout.write(`${e.id}\t${e.text}\n`);
          lastId = e.id;
        }
      }
    });

  // ── list ───────────────────────────────────────────────────────────────────
  discuss
    .command("list [runId]")
    .description("Show thread or pending questions for a run")
    .option("--pending", "Show only unanswered questions", false)
    .option("--json", "Emit JSON instead of human-readable lines", false)
    .option("-R, --run <runId>", "Run id (defaults to AT_RUN_ID)")
    .action(
      async (
        runIdArg: string | undefined,
        opts: { pending: boolean; json: boolean; run?: string },
        command: Command,
      ) => {
        const globals = readGlobals(command);
        const runId = runIdArg ?? opts.run ?? process.env.AT_RUN_ID;
        if (!runId) {
          console.error("[at] discuss list: missing runId (pass arg, -R, or set AT_RUN_ID)");
          process.exit(2);
        }
        const stateDir = resolveStateDir(globals.stateDir as string | undefined);
        const entries = opts.pending ? unansweredQuestions(stateDir, runId) : readThread(stateDir, runId);
        if (globals.json) {
          process.stdout.write(`${JSON.stringify(entries, null, 2)}\n`);
          return;
        }
        for (const e of entries) {
          const opts2 = e.options?.length ? ` [${e.options.join("|")}]` : "";
          const reply = e.replyTo ? ` (replyTo ${e.replyTo})` : "";
          process.stdout.write(`${e.id}\t${e.from}\t${e.kind}${opts2}\t${e.text}${reply}\n`);
        }
      },
    );

  // ── answer ─────────────────────────────────────────────────────────────────
  discuss
    .command("answer <text...>")
    .description("Answer a pending question (defaults to latest unanswered; first arg mN treated as qid)")
    .option("-q, --qid <id>", "Question id to answer (default: latest unanswered)")
    .option("-R, --run <runId>", "Run id (defaults to AT_RUN_ID)")
    .action(async (textParts: string[], opts: { qid?: string; run?: string }, command: Command) => {
      const globals = readGlobals(command);
      const runId = resolveRunId(opts.run);
      const stateDir = resolveStateDir(globals.stateDir as string | undefined);

      if (textParts.length === 0) {
        console.error("[at] discuss answer: missing <text>");
        process.exit(2);
      }

      let replyTo = opts.qid;
      if (!replyTo && /^m\d+$/.test(textParts[0])) {
        replyTo = textParts.shift();
      }

      const text = textParts.join(" ");
      if (!text) {
        console.error("[at] discuss answer: missing <text>");
        process.exit(2);
      }

      if (!replyTo) {
        const pending = latestUnansweredQuestion(stateDir, runId);
        if (!pending) {
          console.error("[at] discuss answer: no pending questions");
          process.exit(1);
        }
        replyTo = pending.id;
      }

      await postDiscussEntry(runId, { from: "host", kind: "answer", text, replyTo }, stateDir);
    });

  // ── say ────────────────────────────────────────────────────────────────────
  discuss
    .command("say <text>")
    .description("Send host message/instruction to the agent (kind=say)")
    .option("-R, --run <runId>", "Run id (defaults to AT_RUN_ID)")
    .action(async (text: string, opts: { run?: string }, command: Command) => {
      const globals = readGlobals(command);
      const runId = resolveRunId(opts.run);
      const stateDir = resolveStateDir(globals.stateDir as string | undefined);
      await postDiscussEntry(runId, { from: "host", kind: "say", text }, stateDir);
    });

  // ── watch ──────────────────────────────────────────────────────────────────
  discuss
    .command("watch")
    .description("Follow the discussion thread live; prompt on questions when interactive")
    .option("-R, --run <runId>", "Run id (defaults to AT_RUN_ID)")
    .option("-i, --interval <ms>", "Poll interval ms", "500")
    .action(async (opts: { run?: string; interval: string }, command: Command) => {
      const globals = readGlobals(command);
      const runId = resolveRunId(opts.run);
      const stateDir = resolveStateDir(globals.stateDir as string | undefined);
      const intervalMs = Number(opts.interval);
      let lastId: string | undefined;
      const seen = new Set<string>();
      const isTTY = Boolean(process.stdin.isTTY);

      function printEntry(e: DiscussEntry): void {
        const tag = `[${e.from}:${e.kind}]`;
        process.stdout.write(`${tag} ${e.id} ${e.text}\n`);
        if (e.options?.length) {
          e.options.forEach((o, i) => {
            process.stdout.write(`    ${i + 1}) ${o}\n`);
          });
        }
        if (e.kind === "question" && isTTY && e.from === "agent") {
          promptForAnswer(e);
        }
      }

      function promptForAnswer(q: DiscussEntry): void {
        const opts2 = q.options ?? [];
        const label = `Answer for ${q.id}`;
        process.stdout.write(`\n? ${label}: `);
        if (opts2.length) {
          opts2.forEach((o, i) => {
            process.stdout.write(`  [${i + 1}] ${o}\n`);
          });
          process.stdout.write(`Choose 1-${opts2.length} (or type freeform): `);
        }
      }

      const tick = async () => {
        const all = readThread(stateDir, runId);
        for (const e of all) {
          if (seen.has(e.id)) continue;
          seen.add(e.id);
          if (lastId && e.id === lastId) continue;
          if (!lastId) {
            lastId = e.id;
            continue; // skip pre-existing on first tick
          }
          printEntry(e);
          lastId = e.id;
        }
      };

      // initial dump
      const all = readThread(stateDir, runId);
      for (const e of all) seen.add(e.id);
      lastId = all[all.length - 1]?.id;

      // First tick now to catch entries added during startup
      await tick();

      const handle = setInterval(() => {
        tick().catch(() => {});
      }, intervalMs);
      await new Promise<void>((resolve) => {
        const stop = () => {
          clearInterval(handle);
          resolve();
        };
        process.once("SIGINT", stop);
        process.once("SIGTERM", stop);
      });
    });
}
