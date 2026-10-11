#!/usr/bin/env node
import { readFileSync } from "node:fs";
import path from "node:path";
import { Command } from "commander";
import { config } from "dotenv";
import { registerCommands } from "./commands";
import { resolveTuiEntry, spawnTui } from "./tui-entry";

config();

const pkg = JSON.parse(readFileSync(path.join(__dirname, "..", "package.json"), "utf8")) as { version: string };
const CLI_VERSION = pkg.version;

const program = new Command();

program.name("at").version(CLI_VERSION).description("Thin wrapper for routing coding tasks to tiered AI agents");

registerCommands(program);

// Make subcommand options win over root options when both define the same flag.
// Without this, `at status --json` is consumed by the root's --json (stdin JSON
// mode) and the status subcommand's --json is left at its default (false),
// so `at status --json` prints markdown instead of JSON. Likewise for
// `at status --no-chop <runId>` — the root's --no-chop and the status
// subcommand's --no-chop both exist; positional resolution lets the
// subcommand's flag apply to its own command. Root-level `--json` for stdin
// mode and `--no-chop` for stream mode still work because they appear before
// any positional (subcommand) argument.
program.enablePositionalOptions();

// No-arg invocation → launch interactive TUI via Bun
if (process.argv.length === 2 && process.stdin.isTTY) {
  const result = spawnTui(resolveTuiEntry());
  if ((result.error as NodeJS.ErrnoException)?.code === "ENOENT") {
    console.error("[at] TUI requires Bun (https://bun.sh). Install Bun or use flags to run without TUI.");
    process.exit(1);
  }
  if (result.signal === "SIGTERM") {
    console.error("[at] TUI timed out");
    process.exit(1);
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
  process.exit(0);
}

program.parse();
