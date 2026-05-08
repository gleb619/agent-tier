#!/usr/bin/env node
import { Command } from 'commander';
import { config } from 'dotenv';
import { AGENTS } from './agents/registry';
import { loadGenericAgents } from './agents/generic-loader';
import { resolveFromArgs, parseJsonInput } from './resolver';
import { run } from './runner';
import { loadConfig, applyTierOverrides, signConfig } from './config';

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
  .option('-r, --retries <number>', 'Max retry attempts with next agent in tier (default: 2)', '2')
  .option('--global-state', 'Single shared round-robin counter across all tiers', false)
  .option('--log-dir <path>', 'Log file directory for detached mode', '/tmp/at-logs')
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
          globalState: opts.globalState as boolean,
          retries: opts.retries,
          logDir: opts.logDir,
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
        });
      }

      await run(runOptions, effectiveAgents);
    } catch (err) {
      console.error(`[at] error: ${(err as Error).message}`);
      process.exit(1);
    }
  });

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

program.parse();
