import type { Command } from "commander";
import { isPidAlive } from "../process-utils";
import { loadRuns, type RunRecord, updateRun } from "../run-store";
import { resolveStatusDirs } from "../state-dir";

export async function stopRun(stateDirs: string | string[], runId: string | undefined, force: boolean): Promise<void> {
  // Joined lookup, same scope `at status` shows: project `.at/` first, then
  // `~/.at/`. A run listed by `at status` must be stoppable from anywhere.
  const dirs = Array.isArray(stateDirs) ? stateDirs : [stateDirs];
  const entries = dirs.flatMap((dir) => loadRuns(dir).map((run) => ({ run, dir })));

  let target: { run: RunRecord; dir: string } | undefined;
  if (runId === undefined) {
    const running = entries
      .filter((e) => e.run.status === "running")
      .sort((a, b) => new Date(b.run.startedAt).getTime() - new Date(a.run.startedAt).getTime());
    target = running[0];
  } else {
    target = entries.find((e) => e.run.runId === runId || e.run.runId.startsWith(runId));
  }

  if (!target) {
    throw new Error(runId === undefined ? "no running run to stop" : `run not found: ${runId}`);
  }

  const { run, dir } = target;
  const resolvedRunId = run.runId;
  const { pid } = run;

  if (!isPidAlive(pid)) {
    console.log(`[at] run ${resolvedRunId} not running (pid ${pid} not alive)`);
    return;
  }

  const signal = force ? "SIGKILL" : "SIGTERM";
  // The runner spawns agents detached, so the stored pid is a process-group
  // leader and -pid takes down the agent's whole tree (wrapper + children).
  // Fall back to the bare pid if the group kill fails (not a group leader).
  try {
    process.kill(-pid, signal);
  } catch {
    try {
      process.kill(pid, signal);
    } catch (err) {
      throw new Error(`failed to signal pid ${pid}: ${(err as Error).message}`);
    }
  }

  const verb = force ? "killed" : "stopped";
  console.log(`[at] ${verb} run ${resolvedRunId} (pid ${pid})`);

  await updateRun(dir, resolvedRunId, {
    status: "failed",
    finishedAt: new Date().toISOString(),
  });
}

export function registerStopCommand(program: Command): void {
  program
    .command("stop [runId]")
    .description("Stop a running agent run (SIGTERM by default, SIGKILL with --force)")
    .option("-F, --force", "Send SIGKILL (kill -9) instead of SIGTERM")
    .action(async (runId: string | undefined, opts: Record<string, unknown>) => {
      try {
        const stateDirs = resolveStatusDirs();
        await stopRun(stateDirs, runId, (opts.force as boolean) ?? false);
      } catch (err) {
        console.error(`[at] error: ${(err as Error).message}`);
        process.exit(1);
      }
    });
}
