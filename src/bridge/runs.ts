import { stopRun } from "../commands/stop";
import { isPidAlive } from "../process-utils";
import { loadRuns, type RunRecord } from "../run-store";
import { joinRuns } from "../status";
import { BridgeError, type BridgeContext, type BridgeParams, type BridgeResource } from "./types";
import { optionalBoolean, optionalString, storeError, withoutStdoutLogs } from "./util";

/**
 * Runs from all ctx state dirs, deduped by runId with scope tags (same join as `at status`).
 * `bridge runs stop|stop-all` — thin async wrappers over `stopRun`
 * (src/commands/stop.ts), same joined lookup + SIGTERM/SIGKILL + run-store
 * update under the runs.jsonl lock the CLI uses. Never spawn agents.
 */

function joinedRuns(stateDirs: string[]): RunRecord[] {
  return joinRuns(
    stateDirs,
    stateDirs.map((d) => loadRuns(d)),
  );
}

function joinedEntries(ctx: BridgeContext): Array<{ run: RunRecord; dir: string }> {
  return ctx.stateDirs.flatMap((dir) => loadRuns(dir).map((run) => ({ run, dir })));
}

function runningEntries(ctx: BridgeContext): Array<{ run: RunRecord; dir: string }> {
  return joinedEntries(ctx)
    .filter((e) => e.run.status === "running")
    .sort((a, b) => new Date(b.run.startedAt).getTime() - new Date(a.run.startedAt).getTime());
}

function optionalStringParam(params: BridgeParams, name: string): string | undefined {
  const raw = params[name];
  if (raw === undefined) return undefined;
  if (typeof raw !== "string" || raw.length === 0) {
    throw new BridgeError("USAGE", `param '${name}' must be a non-empty string`, 2);
  }
  return raw;
}

function optionalLimit(params: BridgeParams): number | undefined {
  const raw = params.limit;
  if (raw === undefined) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) {
    throw new BridgeError("USAGE", "param 'limit' must be a positive number", 2);
  }
  return Math.floor(n);
}

function requiredId(params: BridgeParams): string {
  const id = params.id;
  if (typeof id !== "string" || id.trim().length === 0) {
    throw new BridgeError("USAGE", "param 'id' (non-empty string) is required", 2);
  }
  return id;
}

export const runsResource: BridgeResource = {
  list: (params, ctx) => {
    const agent = optionalStringParam(params, "agent");
    const status = optionalStringParam(params, "status");
    const limit = optionalLimit(params);
    let runs = joinedRuns(ctx.stateDirs);
    if (agent !== undefined) runs = runs.filter((r) => r.agent === agent);
    if (status !== undefined) runs = runs.filter((r) => r.status === status);
    if (limit !== undefined) runs = runs.slice(0, limit);
    return runs;
  },
  get: (params, ctx) => {
    const id = requiredId(params);
    const run = joinedRuns(ctx.stateDirs).find((r) => r.runId === id);
    if (!run) throw new BridgeError("NOT_FOUND", `run not found: ${id}`);
    return run;
  },

  /** params: `{ id?: string, force?: boolean }` — no id stops the newest running run. */
  async stop(params, ctx) {
    const id = optionalString(params, "id");
    const force = optionalBoolean(params, "force") ?? false;

    const target = id
      ? joinedEntries(ctx).find((e) => e.run.runId === id || e.run.runId.startsWith(id))
      : runningEntries(ctx)[0];
    if (!target) {
      throw storeError(new Error(id === undefined ? "no running run to stop" : `run not found: ${id}`), "NOT_FOUND");
    }

    const { run } = target;
    const alive = isPidAlive(run.pid);
    try {
      await withoutStdoutLogs(() => stopRun(ctx.stateDirs, run.runId, force));
    } catch (err) {
      throw storeError(err, "NOT_FOUND");
    }
    return { runId: run.runId, pid: run.pid, signal: force ? "SIGKILL" : "SIGTERM", alive, stopped: alive };
  },

  /** params: `{ force?: boolean }` — signal every running run. */
  async "stop-all"(params, ctx) {
    const force = optionalBoolean(params, "force") ?? false;
    const stopped: string[] = [];
    const errors: Array<{ runId: string; error: string }> = [];

    for (const { run } of runningEntries(ctx)) {
      if (!isPidAlive(run.pid)) continue; // same skip as `at stop` on a dead pid
      try {
        await withoutStdoutLogs(() => stopRun(ctx.stateDirs, run.runId, force));
        stopped.push(run.runId);
      } catch (err) {
        errors.push({ runId: run.runId, error: err instanceof Error ? err.message : String(err) });
      }
    }
    return { stopped, errors };
  },
};