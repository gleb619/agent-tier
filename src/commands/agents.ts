import type { Command } from "commander";
import { buildAgentsReport } from "../agents/report";
import { resolveStatusDirs } from "../state-dir";

export function registerAgentsCommand(program: Command): void {
  program
    .command("agents")
    .description("List registered agents with health state (--json for machine output)")
    .option("--json", "Output as JSON without text trimming", false)
    .action(async (_opts: Record<string, unknown>, cmd: Command) => {
      try {
        // Same global-option dance as `at status --json`: the default command
        // also defines `--json` at the program root.
        const opts = cmd.optsWithGlobals();
        const json = (opts.json as boolean | undefined) ?? false;
        const report = buildAgentsReport(resolveStatusDirs());
        if (json) {
          console.log(JSON.stringify(report));
        } else {
          for (const a of report) {
            const state = a.deactivated ? "deactivated" : "ok";
            console.log(`t${a.tier}  ${a.name.padEnd(10)} ${state}  failures=${a.failures}`);
          }
        }
      } catch (err) {
        console.error(`[at] error: ${(err as Error).message}`);
        process.exit(1);
      }
    });
}
