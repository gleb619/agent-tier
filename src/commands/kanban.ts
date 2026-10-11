import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Command } from "commander";
import { loadBoard, mutateBoard, resolveBoardFile, toTasks } from "../kanban/board";
import { guardKanban } from "../kanban/guard";
import { lintBoard } from "../kanban/lint";
import {
  type AddOptions,
  type OpResult,
  opAdd,
  opClean,
  opList,
  opNext,
  opRemove,
  opShow,
  opStatus,
} from "../kanban/ops";
import { initBoardText } from "../kanban/template";
import { DEFAULT_BOARD_REL, MAX_DESC, REWRITE_TRAILER } from "../kanban/types";
import { findProjectRoot } from "../state-dir";

interface BoardOpts {
  board?: string;
  json?: boolean;
}

function boardPath(file: string | undefined, opts: BoardOpts): string {
  return resolveBoardFile(file ?? opts.board);
}

function printText(r: OpResult): void {
  for (const warning of r.warnings) console.error(warning);
  for (const message of r.messages) console.log(message);
}

function printJson(payload: unknown): void {
  console.log(JSON.stringify(payload, null, 2));
}

function run(fn: () => number): void {
  try {
    const code = fn();
    if (code !== 0) process.exit(code);
  } catch (err) {
    console.error(`[at] error: ${(err as Error).message}`);
    process.exit(1);
  }
}

/** Async sibling of {@link run} for the locked mutateBoard path. */
function runAsync(fn: () => Promise<number>): void {
  fn().then(
    (code) => {
      if (code !== 0) process.exit(code);
    },
    (err) => {
      console.error(`[at] error: ${(err as Error).message}`);
      process.exit(1);
    },
  );
}

export function registerKanbanCommand(program: Command): void {
  const kanban = program.command("kanban").description("Markdown kanban board for agent task tracking");

  kanban
    .command("list [file]")
    .description("List all tasks")
    .option("--board <path>", "board file (default: <project root>/docs/kanban.md)")
    .option("--json", "emit JSON instead of text")
    .action((file: string | undefined, opts: BoardOpts) => {
      run(() => {
        const p = boardPath(file, opts);
        const doc = loadBoard(p);
        if (opts.json) printJson({ file: p, tasks: toTasks(doc) });
        else printText(opList(doc));
        return 0;
      });
    });

  kanban
    .command("next [file]")
    .description("Show the next executable task (In Progress wins, else priority then lowest ID)")
    .option("--board <path>", "board file")
    .option("--start", "mark the selected task In Progress")
    .option("--json", "emit JSON instead of text")
    .action((file: string | undefined, opts: BoardOpts & { start?: boolean }) => {
      const p = boardPath(file, opts);
      const print = (r: OpResult): void => {
        if (opts.json) printJson({ file: p, selection: r.data, warnings: r.warnings });
        else printText(r);
      };
      // Read-only unless --start; the mutation goes through the lock so a
      // concurrent add/remove can't be clobbered between load and save.
      if (opts.start) {
        runAsync(async () => {
          print(await mutateBoard(p, (doc) => opNext(doc, { start: true })));
          return 0;
        });
        return;
      }
      run(() => {
        print(opNext(loadBoard(p)));
        return 0;
      });
    });

  kanban
    .command("show <id> [file]")
    .description("Show one task, optionally with a plan-file preview")
    .option("--board <path>", "board file")
    .option("--with-plan", "print the first 100 lines of the linked plan file")
    .option("--json", "emit JSON instead of text")
    .action((id: string, file: string | undefined, opts: BoardOpts & { withPlan?: boolean }) => {
      run(() => {
        const p = boardPath(file, opts);
        const doc = loadBoard(p);
        const r = opShow(doc, id, { withPlan: opts.withPlan });
        if (opts.json) printJson({ file: p, ...(r.data as object), warnings: r.warnings });
        else printText(r);
        return 0;
      });
    });

  kanban
    .command("add [file]")
    .description("Add a task, or update only the supplied fields of an existing ID (never Status)")
    .option("--board <path>", "board file")
    .option("--id <id>", "task ID (auto-generated as T<max+1> when omitted)")
    .option("--title <title>", "task title")
    .option("--priority <priority>", "High | Medium | Low (default: Low)")
    .option("--owner <owner>", "owner (default: loop)")
    .option("--blocks <ids>", "comma-separated IDs this task blocks")
    .option("--blocked-by <ids>", "comma-separated blocker IDs")
    .option("--plan <path>", "path to the plan file")
    .option("--description <text>", `short description (max ${MAX_DESC} chars, trimmed not rejected)`)
    .option("--json", "emit JSON instead of text")
    .action(
      (
        file: string | undefined,
        opts: BoardOpts & {
          id?: string;
          title?: string;
          priority?: string;
          owner?: string;
          blocks?: string;
          blockedBy?: string;
          plan?: string;
          description?: string;
        },
      ) => {
        runAsync(async () => {
          const p = boardPath(file, opts);
          const addOpts: AddOptions = {
            id: opts.id,
            title: opts.title,
            priority: opts.priority,
            owner: opts.owner,
            blocks: opts.blocks,
            blockedBy: opts.blockedBy,
            plan: opts.plan,
            description: opts.description,
          };
          const r = await mutateBoard(p, (doc) => opAdd(doc, addOpts));
          if (opts.json) printJson({ file: p, ...(r.data as object), warnings: r.warnings });
          else printText(r);
          return 0;
        });
      },
    );

  kanban
    .command("status <id> <status> [file]")
    .description("Change a task status (vocabulary comes from the board Status Legend)")
    .option("--board <path>", "board file")
    .option("--json", "emit JSON instead of text")
    .action((id: string, status: string, file: string | undefined, opts: BoardOpts) => {
      runAsync(async () => {
        const p = boardPath(file, opts);
        const r = await mutateBoard(p, (doc) => opStatus(doc, id, status));
        if (opts.json) printJson({ file: p, ...(r.data as object), warnings: r.warnings });
        else printText(r);
        return 0;
      });
    });

  kanban
    .command("remove <id> [file]")
    .alias("rm")
    .description("Remove a task by ID")
    .option("--board <path>", "board file")
    .option("--json", "emit JSON instead of text")
    .action((id: string, file: string | undefined, opts: BoardOpts) => {
      runAsync(async () => {
        const p = boardPath(file, opts);
        const r = await mutateBoard(p, (doc) => opRemove(doc, id));
        if (opts.json) printJson({ file: p, ...(r.data as object), warnings: r.warnings });
        else printText(r);
        return 0;
      });
    });

  kanban
    .command("clean [file]")
    .description("Remove every Done task")
    .option("--board <path>", "board file")
    .option("--json", "emit JSON instead of text")
    .action((file: string | undefined, opts: BoardOpts) => {
      runAsync(async () => {
        const p = boardPath(file, opts);
        const r = await mutateBoard(p, (doc) => opClean(doc));
        if (opts.json) printJson({ file: p, ...(r.data as object), warnings: r.warnings });
        else printText(r);
        return 0;
      });
    });

  kanban
    .command("lint [file]")
    .description("Structural lint: column count, unique IDs, legend statuses, plan files resolve")
    .option("--board <path>", "board file")
    .option("--root <path>", "repo root used to resolve plan files (default: nearest git root)")
    .option("--json", "emit JSON instead of text")
    .action((file: string | undefined, opts: BoardOpts & { root?: string }) => {
      run(() => {
        const p = boardPath(file, opts);
        const root = opts.root ?? findProjectRoot(path.dirname(p)) ?? path.dirname(path.dirname(p));
        const result = lintBoard(readFileSync(p, "utf8"), root);
        if (opts.json) {
          printJson({ file: p, rows: result.rows, legend: result.legend, violations: result.violations });
          return result.violations.length > 0 ? 1 : 0;
        }
        if (result.violations.length === 0) {
          console.log(`[at] ${p}: ${result.rows} rows — IDs unique, statuses valid, plan files resolve`);
          return 0;
        }
        console.error(`[at] ${p}: ${result.violations.length} violation(s) found:`);
        for (const v of result.violations) console.error(`  - ${v.message}`);
        return 1;
      });
    });

  kanban
    .command("guard <base>")
    .description(`Fail when a row ID present at <base> is gone at HEAD without a '${REWRITE_TRAILER}' commit`)
    .option("--board <path>", `board path relative to the repo root (default: ${DEFAULT_BOARD_REL})`)
    .option("--json", "emit JSON instead of text")
    .action((base: string, opts: BoardOpts) => {
      run(() => {
        const cwd = findProjectRoot(process.cwd()) ?? process.cwd();
        const boardRel = opts.board ?? path.relative(cwd, resolveBoardFile());
        const result = guardKanban(base, cwd, { boardRel });
        if (opts.json) {
          printJson({ base, boardRel, ...result });
          return result.ok ? 0 : 1;
        }
        if (result.ok && !result.rewrite) {
          console.log(`[at] kanban guard: no row IDs dropped since ${base} (${result.baseIds} IDs at base)`);
          return 0;
        }
        if (result.ok) {
          console.warn(
            `[at] kanban guard: ${result.missing.length} row ID(s) dropped since ${base} ` +
              `(${result.missing.join(", ")}), but '${REWRITE_TRAILER}' trailer found — deliberate rewrite accepted`,
          );
          return 0;
        }
        console.error(`[at] kanban guard: ${result.missing.length} row ID(s) present at ${base} but missing at HEAD:`);
        for (const id of result.missing) console.error(`  - ${id}`);
        console.error(
          `If this pruning is deliberate, commit with a message containing the '${REWRITE_TRAILER}' trailer.`,
        );
        return 1;
      });
    });

  kanban
    .command("init [file]")
    .description("Scaffold a new board (legend + empty 9-column task table)")
    .option("--board <path>", "board file")
    .option("--force", "overwrite an existing board")
    .action((file: string | undefined, opts: BoardOpts & { force?: boolean }) => {
      run(() => {
        const p = boardPath(file, opts);
        if (existsSync(p) && !opts.force) {
          throw new Error(`${p} already exists (use --force to overwrite)`);
        }
        mkdirSync(path.dirname(p), { recursive: true });
        writeFileSync(p, initBoardText(), "utf8");
        console.log(`[at] created ${p}`);
        return 0;
      });
    });
}
