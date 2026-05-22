#!/usr/bin/env node
import { Command } from 'commander';
import { config } from 'dotenv';
import { AGENTS } from './agents/registry';
import { loadGenericAgents } from './agents/generic-loader';
import { resolveFromArgs, parseJsonInput } from './resolver';
import { run } from './runner';
import { loadConfig, applyTierOverrides, signConfig } from './config';
import { runInit, formatInitResults, runOrchInit, formatOrchInitResults } from './init';
import { runStatus } from './status';

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

const program = new Command();

program
  .name('at')
  .description('Thin wrapper for routing coding tasks to tiered AI agents')
  .option('-a, --agent <name>', 'Agent name or "auto"', 'auto')
  .option('-t, --tier <number>', 'Tier: 1=architect, 2=dev (default), 3=experimental', '2')
  .option('-p, --prompt <text>', 'Prompt text')
  .option('-s, --stream', 'Stream agent output to terminal (default: detached with log file)', false)
  .option('--no-chop', 'Disable chop output-log compression in stream mode (default: enabled when chop is available)')
  .option('-r, --retries <number>', 'Max extra retry attempts with next agent in tier (default: 0). Total attempts = min(retries+1, agents-in-tier). Named agents never retry', '0')
  .option('--global-state', 'Single shared round-robin counter across all tiers', false)
  .option('--log-dir <path>', 'Log file directory for detached mode', '/tmp/at-logs')
  .option('--timeout <ms>', 'Force-kill agent after N milliseconds (default: 3600000 = 1h)', '3600000')
  .option(
    '--json',
    'Read JSON from stdin: {"agent":"...","prompt":"...","model":"...","cwd":"...","env":{}}',
    false,
  )
  .option('-o, --orchestrate', 'Delegate to an orchestrator instead of a direct agent', false)
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
          globalState: opts.globalState as boolean,
          retries: opts.retries,
          logDir: opts.logDir,
          orchestrate: opts.orchestrate as boolean,
          noChop: !(opts.chop as boolean),
          timeout: opts.timeout,
        });
      } else {
        const stdinData = process.stdin.isTTY ? '' : await readStdin();
        const prompt = stdinData || (opts.prompt as string | undefined) || '';
        runOptions = resolveFromArgs({
          agent: opts.agent,
          tier: opts.tier,
          prompt,
          stream: opts.stream as boolean,
          globalState: opts.globalState as boolean,
          retries: opts.retries,
          logDir: opts.logDir,
          orchestrate: opts.orchestrate as boolean,
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

  # Orchestrator mode — spawn sub-agents for multi-file tasks
  at -o -s -t 1 -p "implement OAuth2 PKCE: routes, service layer, and tests"

  # Pipe prompt from stdin (no shell escaping needed)
  echo "fix the login bug" | at -s

  # Check logs after detached run
  tail -f /tmp/at-logs/at-*.log

  # Config: sign ~/.at/config.json after editing tier overrides
  at config sign

  # Init: bootstrap an ORCH project in the current directory (4 agents: arch/dev/qa/reviewer)
  at init
  at init --name "my-project"

  # Init: preview what ORCH init would do
  at init --dry-run

  # Init: create built-in agent wrapper scripts (existing behavior)
  at init --all
  at init glm-code`,
  );

program
  .command('config <action>')
  .description('Manage ~/.at/config.json (action: sign)')
  .action((action: string) => {
    if (action === 'sign') {
      try {
        signConfig();
      } catch (err) {
        console.error(`[at] error: ${(err as Error).message}`);
        process.exit(1);
      }
    } else {
      console.error(`[at] unknown config action: ${action}`);
      process.exit(1);
    }
  });

program
  .command('init [agent]')
  .description(
    'Bootstrap an ORCH project with 4 tiered agents (default), or create wrapper scripts for built-in agents',
  )
  .option('-a, --all', 'Initialize all built-in agent wrappers', false)
  .option('-l, --list', 'List available built-in agents and their status', false)
  .option('-f, --force', 'Overwrite existing wrapper scripts / re-create ORCH agents', false)
  .option('-n, --dry-run', 'Show what would be created without writing', false)
  .option('-o, --orch', 'Initialize an ORCH project with tiered at agents', false)
  .option('--name <name>', 'Project name for ORCH init (default: current directory name)')
  .action((agent: string | undefined, opts: Record<string, unknown>) => {
    try {
      const isWrapperMode = opts.all || opts.list || agent;
      const isOrchMode = (opts.orch as boolean) || !isWrapperMode;

      if (isOrchMode) {
        // ── ORCH project init ──
        const results = runOrchInit({
          name: opts.name as string | undefined,
          force: opts.force as boolean,
          dryRun: opts.dryRun as boolean,
        });

        console.log('[at] init: ORCH project\n');
        console.log(formatOrchInitResults(results));

        const ok = results.filter((r) => r.status === 'ok').length;
        const skipped = results.filter((r) => r.status === 'skipped').length;
        const errors = results.filter((r) => r.status === 'error').length;
        const wouldExec = results.filter((r) => r.status === 'would_execute').length;

        const parts = [
          ok > 0 ? `${ok} ok` : '',
          skipped > 0 ? `${skipped} skipped` : '',
          errors > 0 ? `${errors} errors` : '',
          wouldExec > 0 ? `${wouldExec} would execute` : '',
        ].filter(Boolean);

        if (parts.length) {
          const label = errors > 0 ? 'done with errors' : 'done';
          console.log(`\n[at] ${label}: ${parts.join(', ')}`);
        }

        if (errors > 0) process.exit(1);
        return;
      }

      // ── Built-in wrapper scripts ──
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
  .command('status')
  .description('Show recent agent runs: running, stuck, done, failed')
  .action(() => {
    try {
      runStatus();
    } catch (err) {
      console.error(`[at] error: ${(err as Error).message}`);
      process.exit(1);
    }
  });

program.parse();
