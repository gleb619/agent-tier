import { loadRuns, type RunRecord } from "../run-store";
import { joinRuns } from "../status";
import { BridgeError, type BridgeParams, type BridgeResource } from "./types";

/** Runs from all ctx state dirs, deduped by runId with scope tags (same join as `at status`). */
function joinedRuns(stateDirs: string[]): RunRecord[] {
  return joinRuns(
    stateDirs,
    stateDirs.map((d) => loadRuns(d)),
  );
}

function optionalString(params: BridgeParams, name: string): string | undefined {
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

/** `bridge runs list` / `bridge runs get` — read-only views over runs.jsonl. No params beyond filters. */
export const runsResource: BridgeResource = {
  list: (params, ctx) => {
    const agent = optionalString(params, "agent");
    const status = optionalString(params, "status");
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
};
