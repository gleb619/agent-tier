import { postDiscussEntry } from "../commands/discuss-helpers";
import { readThread } from "../notify/discuss-store";
import type { DiscussEntry } from "../notify/types";
import { loadRuns } from "../run-store";
import type { BridgeResource } from "./types";
import { BridgeError } from "./types";

function requireRunId(params: Record<string, unknown>): string {
  const runId = typeof params.runId === "string" ? params.runId : typeof params.id === "string" ? params.id : undefined;
  if (!runId) {
    throw new BridgeError("USAGE", "discuss verb requires runId (pass as id or in stdin params)", 2);
  }
  return runId;
}

function readThreadAcross(dirs: string[], runId: string): DiscussEntry[] {
  return dirs.flatMap((d) => readThread(d, runId));
}

function unansweredAcross(dirs: string[], runId: string): DiscussEntry[] {
  const entries = readThreadAcross(dirs, runId);
  const answered = new Set<string>();
  for (const e of entries) {
    if (e.kind === "answer" && e.replyTo) answered.add(e.replyTo);
  }
  return entries.filter((e) => e.kind === "question" && !answered.has(e.id));
}

function findRunDir(dirs: string[], runId: string): string | undefined {
  for (const dir of dirs) {
    if (loadRuns(dir).some((r) => r.runId === runId || r.runId.startsWith(runId))) return dir;
  }
  return undefined;
}

/** `bridge discuss <verb>` — read and write the agent↔host thread. */
export const discussResource: BridgeResource = {
  list: (params, ctx) => {
    const runId = requireRunId(params);
    return params.pending === true ? unansweredAcross(ctx.stateDirs, runId) : readThreadAcross(ctx.stateDirs, runId);
  },

  thread: (params, ctx) => {
    const runId = requireRunId(params);
    return readThreadAcross(ctx.stateDirs, runId);
  },

  answer: async (params, ctx) => {
    const runId = requireRunId(params);
    const qid = typeof params.qid === "string" ? params.qid : undefined;
    const text = typeof params.text === "string" ? params.text : undefined;
    if (!qid || !text) {
      throw new BridgeError("USAGE", "discuss answer requires {runId, qid, text}", 2);
    }
    const stateDir = findRunDir(ctx.stateDirs, runId) ?? ctx.stateDirs[0];
    const id = await postDiscussEntry(runId, { from: "host", kind: "answer", text, replyTo: qid }, stateDir);
    return { id };
  },

  say: async (params, ctx) => {
    const runId = requireRunId(params);
    const text = typeof params.text === "string" ? params.text : undefined;
    if (!text) {
      throw new BridgeError("USAGE", "discuss say requires {runId, text}", 2);
    }
    const stateDir = findRunDir(ctx.stateDirs, runId) ?? ctx.stateDirs[0];
    const id = await postDiscussEntry(runId, { from: "host", kind: "say", text }, stateDir);
    return { id };
  },
};
