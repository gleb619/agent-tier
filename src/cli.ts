#!/usr/bin/env node
import { Command } from 'commander';
import { config } from 'dotenv';
import { AGENTS } from './agents/registry';
import { loadGenericAgents } from './agents/generic-loader';
import { resolveFromArgs, parseJsonInput } from './resolver';
import { run } from './runner';
import { loadConfig, applyTierOverrides, signConfig } from './config';
import { runInit, formatInitResults } from './init/index';
import { runStatus } from './status';
import { resolveStateDir } from './state-dir';
import { setDeactivated, isDeactivated } from './health';
import { loadRuns } from './run-store';
import { getStateFilePath } from './state-dir';

config();

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return '';
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => (data += chunk));
    process.stdin.on('end', () => resolve(data.trim()));
  });
}

import { readFileSync } from 'fs';
import { spawn } from 'child_process';
import path from 'path';
const pkg = JSON.parse(readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')) as { version: string };
const CLI_VERSION = pkg.version;

const program = new Command();

program
  .name('at')
  .version(CLI_VERSION)
  .description('Thin wrapper for routing coding tasks to tiered AI agents')
  .option('-a, --agent <name>', 'Agent name or "auto"', 'auto')
  .option('-t, --tier <number>', 'Tier: 1=architect, 2=dev (default), 3=experimental', '2')
  .option('-p, --prompt <text>', 'Prompt text')
  .option('-s, --stream', 'Stream agent output to terminal via chop/tail (default: detached, fire-and-forget with report)', false)
  .option('--no-chop', 'Disable chop output-log compression in stream mode (default: enabled when chop is available)')
  .option('-r, --retries <number>', 'Max extra retry attempts with next agent in tier (default: 0). Total attempts = min(retries+1, agents-in-tier). Named agents never retry', '0')
  .option('--state-dir <path>', 'State directory (default: .at/ in CWD if exists, else ~/.at/)')
  .option('--log-dir <path>', 'Log file directory for detached mode', '/tmp/at-logs')
  .option('--timeout <ms>', 'Force-kill agent after N milliseconds (default: 3600000 = 1h)', '3600000')
  .option(
    '--json',
    'Read JSON from stdin: {"agent":"...","prompt":"...","model":"...","cwd":"...","env":{}}',
    false,
  )
  .action(async (opts) => {
    try {
      let runOptions;
      const effectiveAgents = applyTierOverrides([...AGENTS, ...loadGenericAgents()], loadConfig());

      if (opts.json) {
        const stdinData = await readStdin();
        const parsed = parseJsonInput(stdinData);
        runOptions = resolveFromArgs({
          agent: parsed.agent,
          tier: opts.tier,
          prompt: parsed.prompt,
          model: parsed.model,
          cwd: parsed.cwd,
          env: parsed.env,
          stream: opts.stream as boolean,
          stateDir: opts.stateDir as string | undefined,
          retries: opts.retries,
          logDir: opts.logDir,
          noChop: !(opts.chop as boolean),
          timeout: opts.timeout,
        });
      } else {
        const stdinData = !opts.prompt && !process.stdin.isTTY ? await readStdin() : '';
        const prompt = stdinData || (opts.prompt as string | undefined) || '';
        runOptions = resolveFromArgs({
          agent: opts.agent,
          tier: opts.tier,
          prompt,
          stream: opts.stream as boolean,
          stateDir: opts.stateDir as string | undefined,
          retries: opts.retries,
          logDir: opts.logDir,
          noChop: !(opts.chop as boolean),
          timeout: opts.timeout,
        });
      }

      const exitCode = await run(runOptions, effectiveAgents);
      if (exitCode !== 0) {
        process.exit(exitCode);
      }
    } catch (err) {
      console.error(`[at] error: ${(err as Error).message}`);
      const code = (err as { code?: number }).code;
      process.exit(code ?? 1);
    }
  })
  .addHelpText(
    'after',
    `
Examples:
  # Detached mode (logs in /tmp/at-logs/, blocks until agent exits) — DEFAULT
  at -p "add error handling to src/api.ts"

  # Stream output to terminal — see progress in real time (most common)
  at -s -p "refactor the auth module"

  # Choose a tier: 1=architect (complex refactors), 2=dev (default), 3=experimental
  at -s -t 1 -p "review auth middleware for security issues across src/auth/"

  # Named agent — skip round-robin, no retry
  at -s -a opencode -p "fix all lint errors in src/utils/"

  # Auto-retry with 2 extra attempts (3 total) before giving up
  at -s -r 2 -p "add input validation across all API endpoints"

  # JSON mode — pass model, cwd, and env programmatically
  echo '{"prompt":"add pagination","agent":"blackbox","cwd":"/home/me/proj"}' | at --json

  # Pipe prompt from stdin (no shell escaping needed)
  echo "fix the login bug" | at -s

  # Check logs after detached run
  tail -f /tmp/at-logs/at-<timestamp>-<agent>.log
`
  );

program
  .command('config sign')
  .description('Sign ~/.at/config.json with HMAC to prevent tampering')
  .action(() => {
    try {
      signConfig();
      console.log('[at] config signed');
    } catch (err) {
      console.error(`[at] error: ${(err as Error).message}`);
      process.exit(1);
    }
  });

program
  .command('init [agent]')
  .description(
    'Create wrapper scripts for built-in agents',
  )
  .option('-a, --all', 'Initialize all built-in agent wrappers', false)
  .option('-l, --list', 'List available built-in agents and their status', false)
  .option('-f, --force', 'Overwrite existing wrapper scripts', false)
  .option('-n, --dry-run', 'Show what would be created without writing', false)
  .action((agent: string | undefined, opts: Record<string, unknown>) => {
    try {
      const results = runInit({
        agent,
        all: opts.all as boolean,
        list: opts.list as boolean,
        force: opts.force as boolean,
        dryRun: opts.dryRun as boolean,
      });
      console.log(formatInitResults(results));

      const created = results.filter((r) => r.action === 'created').length;
      const skipped = results.filter((r) => r.action === 'skipped').length;
      const wouldCreate = results.filter((r) => r.action === 'would_create').length;
      const summary = [
        created > 0 ? `${created} created` : '',
        skipped > 0 ? `${skipped} skipped` : '',
        wouldCreate > 0 ? `${wouldCreate} would be created` : '',
      ]
        .filter(Boolean)
        .join(', ');
      if (summary) {
        console.log(`\n[at] init: ${summary}`);
      }
    } catch (err) {
      console.error(`[at] error: ${(err as Error).message}`);
      process.exit(1);
    }
  });

program
  .command('status [runId]')
  .description('Show recent agent runs: running, stuck, done, failed. With runId, show logs for that run')
  .option('-n, --lines <number>', 'Number of log lines to show (default: all)', value => parseInt(value, 10))
  .option('--head', 'Show lines from the beginning of the log')
  .option('--tail', 'Show lines from the end of the log (default when -n is used)')
  .option('-f, --follow', 'Stream new log lines as they arrive (requires runId)')
  .option('--json', 'Output as JSON without text trimming', false)
  .action((runId: string | undefined, opts: Record<string, unknown>) => {
    try {
      const stateDir = resolveStateDir();
      if (runId) {
        showRunLogs(stateDir, runId, { lines: opts.lines as number | undefined, head: opts.head as boolean, tail: opts.tail as boolean, follow: opts.follow as boolean });
      } else {
        runStatus(stateDir, { json: opts.json as boolean });
      }
    } catch (err) {
      console.error(`[at] error: ${(err as Error).message}`);
      process.exit(1);
    }
  });

function showRunLogs(stateDir: string, runId: string, opts: { lines?: number; head?: boolean; tail?: boolean; follow?: boolean } = {}): void {
  const runs = loadRuns(stateDir);
  const run = runs.find((r) => r.runId === runId || r.runId.startsWith(runId));
  if (!run) {
    console.error(`[at] run not found: ${runId}`);
    process.exit(1);
  }
  console.log(`=== Logs for ${run.runId} (${run.agent}) ===\n`);

  if (opts.follow) {
    try {
      spawn('tail', ['-f', run.logFile], { stdio: 'inherit' });
      return;
    } catch (err) {
      // fall through to reading + watching
    }
  }

  try {
    const logs = readFileSync(run.logFile, 'utf8');
    if (opts.lines !== undefined) {
      const lines = logs.split('\n');
      const slice = opts.head ? lines.slice(0, opts.lines) : lines.slice(-opts.lines);
      process.stdout.write(slice.join('\n') + '\n');
    } else {
      process.stdout.write(logs);
    }
  } catch (err) {
    console.error(`[at] cannot read log: ${run.logFile}`);
    process.exit(1);
  }
}

program
  .command('enable <agent>')
  .description('Re-enable a deactivated agent')
  .action((agent: string) => {
    try {
      const stateDir = resolveStateDir();
      const stateFilePath = getStateFilePath(stateDir);
      setDeactivated(stateFilePath, agent, false);
      console.log(`[at] agent "${agent}" enabled`);
    } catch (err) {
      console.error(`[at] error: ${(err as Error).message}`);
      process.exit(1);
    }
  });

program
  .command('disable <agent>')
  .description('Deactivate an agent (cannot be used even with -a)')
  .action((agent: string) => {
    try {
      const stateDir = resolveStateDir();
      const stateFilePath = getStateFilePath(stateDir);
      setDeactivated(stateFilePath, agent, true);
      console.log(`[at] agent "${agent}" deactivated`);
    } catch (err) {
      console.error(`[at] error: ${(err as Error).message}`);
      process.exit(1);
    }
  });

// No-arg invocation → launch interactive TUI via Bun
if (process.argv.length === 2) {
  const { execFileSync } = require("child_process") as typeof import("child_process");
  const path = require("path") as typeof import("path");
  const tuiEntry = path.join(__dirname, "..", "src", "tui", "index.tsx");
  try {
    execFileSync(
      "bun",
      ["--preload", "@opentui/solid/preload", tuiEntry],
      { stdio: "inherit" }
    );
    process.exit(0);
  } catch (err: unknown) {
    const exitErr = err as { status?: number; code?: string };
    if (exitErr.code === "ENOENT") {
      console.error("[at] TUI requires Bun (https://bun.sh). Install Bun or use flags to run without TUI.");
      process.exit(1);
    }
    process.exit(exitErr.status ?? 1);
  }
}

program.parse();
