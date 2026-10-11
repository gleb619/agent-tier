import type { Command } from "commander";
import {
  addFeedback,
  appendFeedbackLog,
  clearFeedback,
  type FeedbackKind,
  type FeedbackLogOutcome,
  type FeedbackStatus,
  getFeedback,
  listFeedback,
  pruneFeedback,
  removeFeedback,
  updateFeedback,
} from "../feedback-store";
import { loadRuns } from "../run-store";
import { resolveFeedbackDir } from "../state-dir";

function parseTags(value: string, previous: string[] = []): string[] {
  return [
    ...previous,
    ...value
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  ];
}

function validateKind(value: string): FeedbackKind {
  if (value === "bug" || value === "improvement" || value === "note") {
    return value;
  }
  throw new Error("kind must be bug, improvement, or note");
}

function validateStatus(value: string): FeedbackStatus {
  if (value === "open" || value === "resolved" || value === "wontfix") {
    return value;
  }
  throw new Error("status must be open, resolved, or wontfix");
}

function validateOutcome(value: string): FeedbackLogOutcome {
  if (value === "try" || value === "ok" || value === "failed" || value === "info") {
    return value;
  }
  throw new Error("outcome must be try, ok, failed, or info");
}

function formatLine(entry: { id: string; status: string; kind: string; agent?: string; text: string }): string {
  const preview = entry.text.replace(/\s+/g, " ").trim().slice(0, 80);
  const agentPart = entry.agent ? ` [${entry.agent}]` : "";
  return `${entry.id} ${entry.status} ${entry.kind}${agentPart} ${preview}`;
}

function showDetail(entry: {
  id: string;
  kind: string;
  text: string;
  status: string;
  agent?: string;
  runId?: string;
  tier?: number;
  tags?: string[];
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string;
  cwd?: string;
  atVersion?: string;
  context?: string;
  log?: {
    at: string;
    state?: string;
    subState?: string;
    outcome: string;
    note: string;
    runId?: string;
    files?: string[];
  }[];
}): void {
  console.log(`id:        ${entry.id}`);
  console.log(`kind:      ${entry.kind}`);
  console.log(`status:    ${entry.status}`);
  if (entry.agent) console.log(`agent:     ${entry.agent}`);
  if (entry.runId) console.log(`runId:     ${entry.runId}`);
  if (entry.tier !== undefined) console.log(`tier:      ${entry.tier}`);
  if (entry.tags?.length) console.log(`tags:      ${entry.tags.join(", ")}`);
  console.log(`createdAt: ${entry.createdAt}`);
  console.log(`updatedAt: ${entry.updatedAt}`);
  if (entry.resolvedAt) console.log(`resolvedAt:${entry.resolvedAt}`);
  if (entry.cwd) console.log(`cwd:       ${entry.cwd}`);
  if (entry.atVersion) console.log(`version:   ${entry.atVersion}`);
  if (entry.context) console.log(`context:   ${entry.context}`);
  console.log(`text:`);
  console.log(entry.text);
  if (entry.log?.length) {
    console.log(`log:`);
    for (const item of entry.log) {
      const where = [item.state, item.subState].filter(Boolean).join("/");
      const run = item.runId ? ` run=${item.runId}` : "";
      const files = item.files?.length ? ` files=${item.files.join(",")}` : "";
      console.log(`  ${item.at} ${item.outcome}${where ? ` ${where}` : ""}${run}${files} ${item.note}`);
    }
  }
}

export function registerFeedbackCommand(program: Command): void {
  const feedback = program.command("feedback").description("Manage feedback notes for at and its agents");

  feedback
    .command("add <text>")
    .description("Add a feedback note")
    .option("-k, --kind <kind>", "bug, improvement, or note (default: note)", "note")
    .option("-a, --agent <agent>", "agent name")
    .option("-r, --run <runId>", "run id; auto-fills agent/tier if found")
    .option("-T, --tag <tag...>", "tags (repeatable or comma-separated)", parseTags)
    .option("--context <context>", "extra context (exit code, error snippet)")
    .action(async (text: string, opts: Record<string, unknown>) => {
      try {
        const stateDir = resolveFeedbackDir();
        let agent = opts.agent as string | undefined;
        let tier: number | undefined;
        const runId = opts.run as string | undefined;

        if (runId) {
          const runs = loadRuns(stateDir);
          const run = runs.find((r) => r.runId === runId || r.runId.startsWith(runId));
          if (run) {
            agent = agent ?? run.agent;
            tier = tier ?? run.tier;
          }
        }

        if (!text || text.trim().length === 0) {
          throw new Error("feedback text cannot be empty");
        }
        if (text.length > 4000) {
          throw new Error("feedback text exceeds 4000 characters");
        }

        const tags = (opts.tag as string[] | undefined) ?? [];

        const { entry, evicted } = await addFeedback(stateDir, {
          text,
          kind: validateKind(opts.kind as string),
          agent,
          runId,
          tier,
          tags: tags.length > 0 ? tags : undefined,
          context: opts.context as string | undefined,
          cwd: process.cwd(),
        });

        console.log(`[at] feedback ${entry.id} added`);
        if (evicted > 0) {
          console.log(`[at] feedback: evicted ${evicted} old entries`);
        }
      } catch (err) {
        console.error(`[at] error: ${(err as Error).message}`);
        process.exit(1);
      }
    });

  feedback
    .command("list")
    .alias("ls")
    .description("List feedback entries (newest first)")
    .option("--status <status>", "filter by status")
    .option("--kind <kind>", "filter by kind")
    .option("--agent <agent>", "filter by agent")
    .option("--tag <tag>", "filter by tag")
    .option("-n, --limit <n>", "max entries", "20")
    .option("--json", "output JSON")
    .action(async (opts: Record<string, unknown>, cmd: Command) => {
      // root program also defines --json and swallows it; fall back to parent value
      opts.json = opts.json ?? cmd.parent?.parent?.opts().json;
      try {
        const stateDir = resolveFeedbackDir();
        const entries = listFeedback(stateDir, {
          status: opts.status ? validateStatus(opts.status as string) : undefined,
          kind: opts.kind ? validateKind(opts.kind as string) : undefined,
          agent: opts.agent as string | undefined,
          tag: opts.tag as string | undefined,
          limit: Number(opts.limit as string),
        });

        if (opts.json) {
          console.log(JSON.stringify(entries, null, 2));
          return;
        }

        if (entries.length === 0) {
          console.log("[at] no feedback entries");
          return;
        }

        for (const entry of entries) {
          console.log(formatLine(entry));
        }
      } catch (err) {
        console.error(`[at] error: ${(err as Error).message}`);
        process.exit(1);
      }
    });

  feedback
    .command("show <id>")
    .description("Show a feedback entry in full")
    .option("--json", "output JSON")
    .action(async (id: string, opts: Record<string, unknown>, cmd: Command) => {
      opts.json = opts.json ?? cmd.parent?.parent?.opts().json;
      try {
        const stateDir = resolveFeedbackDir();
        const entry = getFeedback(stateDir, id);
        if (!entry) {
          throw new Error(`feedback not found: ${id}`);
        }

        if (opts.json) {
          console.log(JSON.stringify(entry, null, 2));
          return;
        }

        showDetail(entry);
      } catch (err) {
        console.error(`[at] error: ${(err as Error).message}`);
        process.exit(1);
      }
    });

  feedback
    .command("update <id>")
    .description("Update a feedback entry")
    .option("--text <text>", "new text")
    .option("--kind <kind>", "new kind")
    .option("--status <status>", "new status")
    .option("--agent <agent>", "new agent")
    .option("--tag <tag...>", "replace tags (repeatable or comma-separated)", parseTags)
    .action(async (id: string, opts: Record<string, unknown>) => {
      try {
        const stateDir = resolveFeedbackDir();
        const tags = opts.tag as string[] | undefined;

        const entry = await updateFeedback(stateDir, id, {
          text: opts.text as string | undefined,
          kind: opts.kind ? validateKind(opts.kind as string) : undefined,
          status: opts.status ? validateStatus(opts.status as string) : undefined,
          agent: opts.agent as string | undefined,
          tags: tags !== undefined ? (tags.length > 0 ? tags : []) : undefined,
        });

        console.log(`[at] feedback ${entry.id} updated`);
      } catch (err) {
        console.error(`[at] error: ${(err as Error).message}`);
        process.exit(1);
      }
    });

  feedback
    .command("resolve <id>")
    .description("Mark a feedback entry as resolved")
    .option("--wontfix", "mark as wontfix instead of resolved")
    .action(async (id: string, opts: Record<string, unknown>) => {
      try {
        const stateDir = resolveFeedbackDir();
        const status: FeedbackStatus = opts.wontfix ? "wontfix" : "resolved";
        const entry = await updateFeedback(stateDir, id, { status });
        console.log(`[at] feedback ${entry.id} ${entry.status}`);
      } catch (err) {
        console.error(`[at] error: ${(err as Error).message}`);
        process.exit(1);
      }
    });

  feedback
    .command("log <id> <note>")
    .description("Append a try/change record to an entry (expires via log TTL, default 7d)")
    .option("--state <state>", "loop state, e.g. EXECUTE")
    .option("--sub <subState>", "loop sub-state, e.g. DELEGATE")
    .option("-o, --outcome <outcome>", "try, ok, failed, or info (default: info)", "info")
    .option("-r, --run <runId>", "at run id")
    .option("-f, --file <file...>", "changed files (repeatable or comma-separated)", parseTags)
    .action(async (id: string, note: string, opts: Record<string, unknown>) => {
      try {
        const stateDir = resolveFeedbackDir();
        const entry = await appendFeedbackLog(stateDir, id, {
          note,
          state: opts.state as string | undefined,
          subState: opts.sub as string | undefined,
          outcome: validateOutcome(opts.outcome as string),
          runId: opts.run as string | undefined,
          files: opts.file as string[] | undefined,
        });
        console.log(`[at] feedback ${entry.id} log: ${entry.log?.length ?? 0} items`);
      } catch (err) {
        console.error(`[at] error: ${(err as Error).message}`);
        process.exit(1);
      }
    });

  feedback
    .command("rm <ids...>")
    .description("Remove feedback entries by id or unique prefix")
    .action(async (ids: string[], _opts: Record<string, unknown>) => {
      try {
        const stateDir = resolveFeedbackDir();
        const removed = await removeFeedback(stateDir, ids);
        console.log(`[at] feedback: removed ${removed} entries`);
      } catch (err) {
        console.error(`[at] error: ${(err as Error).message}`);
        process.exit(1);
      }
    });

  feedback
    .command("clear")
    .description("Clear feedback entries")
    .option("--resolved", "clear resolved/wontfix entries")
    .option("--all", "clear all entries")
    .option("--yes", "confirm --all")
    .action(async (opts: Record<string, unknown>) => {
      try {
        const stateDir = resolveFeedbackDir();
        const removed = await clearFeedback(stateDir, {
          resolved: opts.resolved as boolean | undefined,
          all: opts.all as boolean | undefined,
          yes: opts.yes as boolean | undefined,
        });
        console.log(`[at] feedback: cleared ${removed} entries`);
      } catch (err) {
        console.error(`[at] error: ${(err as Error).message}`);
        process.exit(1);
      }
    });

  feedback
    .command("prune")
    .description("Run feedback autoclean now")
    .action(async () => {
      try {
        const stateDir = resolveFeedbackDir();
        const evicted = await pruneFeedback(stateDir);
        console.log(`[at] feedback: pruned ${evicted} entries`);
      } catch (err) {
        console.error(`[at] error: ${(err as Error).message}`);
        process.exit(1);
      }
    });
}
