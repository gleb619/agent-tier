import { readFileSync } from "node:fs";
import type { Command } from "commander";
import { loadBoard, resolveBoardFile, toTasks } from "../kanban/board";
import { resolveStateDir } from "../state-dir";
import { resolveModelConfig, triage } from "../triage";

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
    .description("Advise a delegation route (single agent vs two-agent compose); never spends an agent run")
    .option("-p, --prompt <text>", "Task prompt")
    .option("-f, --file <path>", "Read the task prompt from a file")
    .option("--task <id>", "Triage a kanban task (title + description + plan file)")
    .option("--board <file>", "Board file for --task")
    .option(
      "--provider <name>",
      "Refine with a model: local-ollama | remote-ollama | openrouter (or AT_TRIAGE_PROVIDER)",
    )
    .option("--json", "Print the full result as JSON", false)
    .action(async (opts: Record<string, string | boolean | undefined>) => {
      try {
        const prompt = readPrompt(opts as { prompt?: string; file?: string; task?: string; board?: string });
        const cfg = resolveModelConfig(process.env, resolveStateDir(), opts.provider as string | undefined);
        const result = await triage(prompt, {
          model: cfg && "opts" in cfg ? cfg.opts : undefined,
        });
        if (cfg && "error" in cfg) result.note = cfg.error;
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
