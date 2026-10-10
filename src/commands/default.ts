import { Command } from 'commander';
import { AGENTS } from '../agents/registry';
import { loadGenericAgents } from '../agents/generic-loader';
import { resolveFromArgs, parseJsonInput } from '../resolver';
import { run } from '../runner';
import { loadConfig, applyTierOverrides } from '../config';
import { readPromptFile } from '../prompt-file';

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
    .option('-f, --prompt-file <path>', 'Path to a file containing the prompt (.md or .json)')
    .option('-s, --stream', 'Stream agent output to terminal via chop/tail (default: detached, fire-and-forget with report)', false)
    .option(
      '--wait',
      'In detached mode, block until the agent exits (enables timeout, retry, agent-health tracking and callback with the real exit code). Default: return immediately after the run box',
      false,
    )
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
    .option(
      '--verify <command>',
      'Shell command run after the agent exits, before --callback. Non-zero exit fails the run (status=failed, log line, AgentError raised in blocking modes to trigger retry-with-next-agent, AT_STATUS=failed in callback). Exposes the same AT_* env vars as --callback plus AT_VERIFY_CMD.',
    )
    .option('--sse [port]', 'Enable SSE live-progress hub (default port 7777, 0=random)')
    .option(
      '--json',
      'Read JSON from stdin: {"agent":"...","prompt":"...","model":"...","cwd":"...","env":{},"sse":true,"ssePort":0}',
      false,
    )
    .action(async (opts) => {
      try {
        let runOptions;
        const effectiveAgents = applyTierOverrides([...AGENTS, ...loadGenericAgents()], loadConfig());
        let filePrompt = '';
        if (opts.promptFile) {
          filePrompt = readPromptFile(opts.promptFile as string);
        }


        if (opts.json) {
          const stdinData = await readStdin();
          const parsed = parseJsonInput(stdinData);
          const finalPrompt = (parsed.prompt || parsed.promptFileContent || filePrompt || opts.prompt || '').trim();
          runOptions = resolveFromArgs({
            agent: parsed.agent,
            tier: opts.tier,
            prompt: finalPrompt,
            model: parsed.model,
            cwd: parsed.cwd,
            env: parsed.env,
            stream: opts.stream as boolean,
            wait: opts.wait as boolean,
            stateDir: opts.stateDir as string | undefined,
            retries: opts.retries,
            logDir: opts.logDir,
            noChop: !(opts.chop as boolean),
            timeout: opts.timeout,
            callback: parsed.callback ?? opts.callback,
            verify: parsed.verify ?? opts.verify,
            sse: parsed.sse,
            ssePort: parsed.ssePort,
          });
        } else {
          const stdinData = !opts.prompt && !opts.promptFile && !process.stdin.isTTY ? await readStdin() : '';
          const finalPrompt = (stdinData || filePrompt || (opts.prompt as string | undefined) || '').trim();
          runOptions = resolveFromArgs({
            agent: opts.agent,
            tier: opts.tier,
            prompt: finalPrompt,
            model: opts.model as string | undefined,
            stream: opts.stream as boolean,
            wait: opts.wait as boolean,
            stateDir: opts.stateDir as string | undefined,
            retries: opts.retries,
            logDir: opts.logDir,
            noChop: !(opts.chop as boolean),
            timeout: opts.timeout,
            callback: opts.callback,
            verify: opts.verify as string | undefined,
            sse: opts.sse,
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
  # Detached mode (logs in /tmp/at-logs/) — returns as soon as the run box prints — DEFAULT
  at -p "add error handling to src/api.ts"

  # Detached mode, but block until the agent exits (timeout, retry, health, real callback exit code)
  at --wait -p "fix the flaky test in tests/api.test.ts"

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
