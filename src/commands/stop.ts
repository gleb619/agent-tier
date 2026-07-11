import { Command } from 'commander';
import { resolveStateDir } from '../state-dir';
import { loadRuns, updateRun } from '../run-store';
import { isPidAlive } from '../process-utils';

export async function stopRun(stateDir: string, runId: string | undefined, force: boolean): Promise<void> {
  const runs = loadRuns(stateDir);

  let target = runs.find((r) => r.runId === runId || r.runId.startsWith(runId ?? ''));
  if (runId === undefined) {
    const running = runs.filter((r) => r.status === 'running');
    running.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
    target = running[0];
    if (!target) {
      throw new Error('no running run to stop');
    }
  }

  if (!target) {
    throw new Error(`run not found: ${runId}`);
  }

  const resolvedRunId = target.runId;
  const { pid } = target;

  if (!isPidAlive(pid)) {
    console.log(`[at] run ${resolvedRunId} not running (pid ${pid} not alive)`);
    return;
  }

  const signal = force ? 'SIGKILL' : 'SIGTERM';
  try {
    process.kill(pid, signal);
  } catch (err) {
    throw new Error(`failed to signal pid ${pid}: ${(err as Error).message}`);
  }

  const verb = force ? 'killed' : 'stopped';
  console.log(`[at] ${verb} run ${resolvedRunId} (pid ${pid})`);

  await updateRun(stateDir, resolvedRunId, {
    status: 'failed',
    finishedAt: new Date().toISOString(),
  });
}

export function registerStopCommand(program: Command): void {
  program
    .command('stop [runId]')
    .description('Stop a running agent run (SIGTERM by default, SIGKILL with --force)')
    .option('-F, --force', 'Send SIGKILL (kill -9) instead of SIGTERM')
    .action(async (runId: string | undefined, opts: Record<string, unknown>) => {
      try {
        const stateDir = resolveStateDir();
        await stopRun(stateDir, runId, (opts.force as boolean) ?? false);
      } catch (err) {
        console.error(`[at] error: ${(err as Error).message}`);
        process.exit(1);
      }
    });
}
