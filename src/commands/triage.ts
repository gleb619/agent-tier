import { readFileSync } from "node:fs";
import type { Command } from "commander";
import { loadBoard, resolveBoardFile, toTasks } from "../kanban/board";
import { resolveStateDir } from "../state-dir";
import { breakerDownUntil, loadTriageConfig, resolveTriageProviders, triage, triageConfigPath } from "../triage";

function readPrompt(opts: { prompt?: string; file?: string; task?: string; board?: string }): string {
  if (opts.prompt) return opts.prompt;
  if (opts.file) return readFileSync(opts.file, "utf8");
  if (opts.task) {
    const task = toTasks(loadBoard(resolveBoardFile(opts.board))).find((t) => t.ID === opts.task);
    if (!task) throw new Error(`task ${opts.task} not found`);
    const planRaw = (task["Plan File"] ?? "").replace(/`/g, "").trim();
    let plan = "";
    try {
      plan = planRaw && planRaw !== "-" ? readFileSync(planRaw, "utf8") : "";
    } catch {
      // plan file is a hint only
    }
    return [task.Title, task.Description, plan].filter((s) => s && s !== "-").join("\n\n");
  }
  throw new Error("one of -p/--prompt, -f/--file, --task is required");
}

export function registerTriageCommand(program: Command): void {
  program
    .command("triage")
    .description("Advise a delegation route (single agent vs plan-then-do compose); never spends an agent run")
    .option("-p, --prompt <text>", "Task prompt")
    .option("-f, --file <path>", "Read the task prompt from a file")
    .option("--task <id>", "Triage a kanban task (title + description + plan file)")
    .option("--board <file>", "Board file for --task")
    .option(
      "--provider <names>",
      "Provider name(s) from ~/.at/triage.json (comma list, tried in order); overrides `use`",
    )
    .option("--list", "List configured providers and breaker state", false)
    .option("--json", "Print the full result as JSON", false)
    .action(async (opts: Record<string, string | boolean | undefined>) => {
      try {
        if (opts.list) {
          const stateDir = resolveStateDir();
          const cfg = loadTriageConfig(stateDir);
          console.log(`config: ${triageConfigPath(stateDir)}  use: ${cfg.use.join(",") || "(none — heuristic only)"}`);
          for (const p of cfg.providers) {
            const down = breakerDownUntil(stateDir, p.name);
            const state = down > Date.now() ? `down ${Math.ceil((down - Date.now()) / 1000)}s` : "ok";
            console.log(`${p.name}\t${p.type}\t${p.url}\t${p.model ?? "(default)"}\t${state}`);
          }
          return;
        }
        const prompt = readPrompt(opts as { prompt?: string; file?: string; task?: string; board?: string });
        const stateDir = resolveStateDir();
        const { models, errors } = await resolveTriageProviders(stateDir, opts.provider as string | undefined);
        const result = await triage(prompt, { models });
        if (errors.length > 0) result.note = [result.note, ...errors].filter(Boolean).join("; ");
        if (opts.json) {
          console.log(JSON.stringify(result));
        } else {
          const parts = [
            `route=${result.route}`,
            `tier=${result.tier}`,
            `signals=${result.signals.join(",") || "none"}`,
            `source=${result.source}`,
          ];
          if (result.note) parts.push(`note=${result.note}`);
          console.log(parts.join(" "));
        }
      } catch (err) {
        console.error(`[triage] ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }
    });
}
