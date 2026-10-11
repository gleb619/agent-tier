import type { Command } from "commander";
import { startMcpServer } from "../mcp/server";
import { resolveStateDir } from "../state-dir";

export function registerMcpCommand(program: Command): void {
  program
    .command("mcp")
    .description("Start MCP server on stdio (for Claude Code, Cursor, etc.)")
    .option("--state-dir <path>", "State directory override (default: auto-resolve)")
    .addHelpText(
      "after",
      `
Examples:
  $ at mcp                          # start MCP server
  $ at mcp --state-dir /tmp/at      # override state dir

  Add to ~/.claude.json:
  {
    "mcpServers": {
      "at": {
        "command": "npx",
        "args": ["-y", "at", "mcp"]
      }
    }
  }
`,
    )
    .action(async (opts: Record<string, unknown>) => {
      try {
        const stateDir = resolveStateDir(opts.stateDir as string | undefined);
        await startMcpServer(stateDir);
      } catch (err) {
        console.error(`[at] MCP server error: ${(err as Error).message}`);
        process.exit(1);
      }
    });
}
