import { Command } from 'commander';
import { AGENTS } from '../agents/registry';
import { loadGenericAgents } from '../agents/generic-loader';
import { resolveFromArgs, parseJsonInput } from '../resolver';
import { run } from '../runner';
import { loadConfig, applyTierOverrides } from '../config';

/** T11: warn (once per run) when deprecated --namer-model / --namer-url are set. */
export function warnDeprecatedNamerFlags(opts: { namerModel?: unknown; namerUrl?: unknown }): void {
  if (typeof opts.namerModel === 'string' && opts.namerModel.length > 0) {
    console.warn('[at] --namer-model is deprecated; configure ~/.at/namer.json instead');
  }
  if (typeof opts.namerUrl === 'string' && opts.namerUrl.length > 0) {
    console.warn('[at] --namer-url is deprecated; configure ~/.at/namer.json instead');
  }
}

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return '';
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => (data += chunk));
    process.stdin.on('end', () => resolve(data.trim()));
  });
}

export function registerDefaultCommand(program: Command): void {
  program
    .option('-a, --agent <name>', 'Agent name or "auto"', 'auto')
    .option('-t, --tier <number>', 'Tier: 1=architect, 2=dev (default), 3=experimental', '2')
    .option('-p, --prompt <text>', 'Prompt text')
    .option('-s, --stream', 'Stream agent output to terminal via chop/tail (default: detached, fire-and-forget with report)', false)
    .option('--no-chop', 'Disable chop output-log compression in stream mode (default: enabled when chop is available)')
    .option('-r, --retries <number>', 'Max extra retry attempts with next agent in tier (default: 0). Total attempts = min(retries+1, agents-in-tier). Named agents never retry', '0')
    .option('--state-dir <path>', 'State directory (default: .at/ in CWD if exists, else ~/.at/)')
    .option('--log-dir <path>', 'Log file directory for detached mode', '/tmp/at-logs')
    .option('--timeout <ms>', 'Force-kill agent after N milliseconds (default: 3600000 = 1h)', '3600000')
    .option('-m, --model <name>', 'Model name to pass to the agent')
    .option(
      '--callback <command>',
      'Shell command to run after the agent job finishes. Exposes AT_RUN_ID, AT_AGENT, AT_TIER, AT_EXIT_CODE, AT_LOG_FILE, AT_PROMPT, AT_STATUS env vars',
    )
    .option('--sse [port]', 'Enable SSE live-progress hub (default port 7777, 0=random)')
    .option(
      '--namer',
      '[experimental] Ask a local Ollama model (default: gemma3:1b) to name the session from the prompt. Persisted on the run record and shown in `at status`. Off by default.',
      false,
    )
    .option('--namer-model <name>', '[DEPRECATED] Use namer.json config; this flag is ignored')
    .option('--namer-url <url>', '[DEPRECATED] Use namer.json config; this flag is ignored')
    .option(
      '--json',
      'Read JSON from stdin: {"agent":"...","prompt":"...","model":"...","cwd":"...","env":{},"sse":true,"ssePort":0}',
      false,
    )
    .action(async (opts) => {
      // T11: --namer-model / --namer-url are deprecated no-op shims.
      warnDeprecatedNamerFlags(opts);
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
            callback: parsed.callback ?? opts.callback,
            sse: parsed.sse,
            ssePort: parsed.ssePort,
            namer: parsed.namer ?? (opts.namer as boolean),
            namerModel: parsed.namerModel ?? (opts.namerModel as string | undefined),
            namerUrl: parsed.namerUrl ?? (opts.namerUrl as string | undefined),
          });
        } else {
          const stdinData = !opts.prompt && !process.stdin.isTTY ? await readStdin() : '';
          const prompt = stdinData || (opts.prompt as string | undefined) || '';
          runOptions = resolveFromArgs({
            agent: opts.agent,
            tier: opts.tier,
            prompt,
            model: opts.model as string | undefined,
            stream: opts.stream as boolean,
            stateDir: opts.stateDir as string | undefined,
            retries: opts.retries,
            logDir: opts.logDir,
            noChop: !(opts.chop as boolean),
            timeout: opts.timeout,
            callback: opts.callback,
            sse: opts.sse,
            namer: opts.namer as boolean,
            namerModel: opts.namerModel as string | undefined,
            namerUrl: opts.namerUrl as string | undefined,
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

  # JSON mode — pass model, cwd, env, sse programmatically
  echo '{"prompt":"add pagination","agent":"mm-code","cwd":"/home/me/proj","sse":true}' | at --json

  # Pipe prompt from stdin (no shell escaping needed)
  echo "fix the login bug" | at -s

  # Check logs after detached run
  tail -f /tmp/at-logs/at-<timestamp>-<agent>.log

  # SSE live-progress
  at -p "big refactor" --sse
  at -p "big refactor" --sse 0
`
    );
}
