#!/usr/bin/env node
import { Command } from 'commander';
import { config } from 'dotenv';
import { readFileSync } from 'fs';
import { spawnSync } from 'child_process';
import path from 'path';
import { registerCommands } from './commands';

config();

const pkg = JSON.parse(readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')) as { version: string };
const CLI_VERSION = pkg.version;

const program = new Command();

program
  .name('at')
  .version(CLI_VERSION)
  .description('Thin wrapper for routing coding tasks to tiered AI agents');

registerCommands(program);

// No-arg invocation → launch interactive TUI via Bun
if (process.argv.length === 2 && process.stdin.isTTY) {
  const tuiEntry = path.join(__dirname, '..', 'src', 'tui', 'index.tsx');
  const result = spawnSync('bun', ['--preload', '@opentui/solid/preload', tuiEntry], {
    stdio: 'inherit',
    timeout: 1800000,
  });
  if ((result.error as NodeJS.ErrnoException)?.code === 'ENOENT') {
    console.error('[at] TUI requires Bun (https://bun.sh). Install Bun or use flags to run without TUI.');
    process.exit(1);
  }
  if (result.signal === 'SIGTERM') {
    console.error('[at] TUI timed out');
    process.exit(1);
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
  process.exit(0);
}

program.parse();
