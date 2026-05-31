import { Command } from 'commander';
import { existsSync, readFileSync } from 'fs';
import { spawn } from 'child_process';
import path from 'path';
import { resolveStateDir } from '../state-dir';
import { runStatus } from '../status';
import { loadRuns } from '../run-store';
import { chopLines } from '../chop';

function showRunLogs(
  stateDir: string,
  runId: string,
  opts: { lines?: number; head?: boolean; tail?: boolean; follow?: boolean; noChop?: boolean } = {},
): void {
  const runs = loadRuns(stateDir);
  const run = runs.find((r) => r.runId === runId || r.runId.startsWith(runId));
  if (!run) {
    console.error(`[at] run not found: ${runId}`);
    process.exit(1);
  }
  console.log(`=== Logs for ${run.runId} (${run.agent}) ===\n`);

  if (opts.follow) {
    try {
      const logStreamerJs = path.join(__dirname, '..', 'log-streamer.js');
      const useStreamer = !opts.noChop && existsSync(logStreamerJs);
      if (useStreamer) {
        spawn('node', [logStreamerJs, '--log', run.logFile, '--pid', String(process.pid)], { stdio: 'inherit' });
        return;
      }
    } catch {
      // fall through to plain tail
    }
    spawn('tail', ['-f', run.logFile], { stdio: 'inherit' });
    return;
  }

  try {
    const logs = readFileSync(run.logFile, 'utf8');
    const finalOutput = opts.noChop ? logs : chopLines(logs);
    if (opts.lines !== undefined) {
      const lines = finalOutput.split('\n');
      const slice = opts.head ? lines.slice(0, opts.lines) : lines.slice(-opts.lines);
      process.stdout.write(slice.join('\n') + '\n');
    } else {
      process.stdout.write(finalOutput);
    }
  } catch {
    console.error(`[at] cannot read log: ${run.logFile}`);
    process.exit(1);
  }
}

export function registerStatusCommand(program: Command): void {
  program
    .command('status [runId]')
    .description('Show recent agent runs: running, stuck, done, failed. With runId, show logs for that run')
    .option('-n, --lines <number>', 'Number of log lines to show (default: all)', (value) => parseInt(value, 10))
    .option('--head', 'Show lines from the beginning of the log')
    .option('--tail', 'Show lines from the end of the log (default when -n is used)')
    .option('-f, --follow', 'Stream new log lines as they arrive (requires runId)')
    .option('--no-chop', 'Disable log filtering (ANSI, spinners, repeated lines)')
    .option('--json', 'Output as JSON without text trimming', false)
    .action((runId: string | undefined, opts: Record<string, unknown>) => {
      try {
        const stateDir = resolveStateDir();
        if (runId) {
          showRunLogs(stateDir, runId, {
            lines: opts.lines as number | undefined,
            head: opts.head as boolean,
            tail: opts.tail as boolean,
            follow: opts.follow as boolean,
            noChop: (opts.noChop as boolean) ?? false,
          });
        } else {
          runStatus(stateDir, { json: opts.json as boolean });
        }
      } catch (err) {
        console.error(`[at] error: ${(err as Error).message}`);
        process.exit(1);
      }
    });
}
