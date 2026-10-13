import { withLock } from "../lock";
import type { ComposeWorkspace } from "./workspace";

export type ComposePhase = "INVESTIGATE" | "PLAN" | "IMPLEMENT" | "CHECK" | "DONE" | "FAILED";

export interface ComposeRunRef {
  phase: ComposePhase;
  /** Checklist index, for IMPLEMENT runs. */
  item?: number;
  runId: string;
}

export interface ComposeState {
  goal: string;
  state: ComposePhase;
  round: number;
  testCmd: string;
  maxRounds: number;
  /** In-flight agent runs, so resume can reattach instead of restarting. */
  runs?: ComposeRunRef[];
}

export const STATE_FILE = "state.json";

export const DEFAULT_TEST_CMD = "npm test";
export const DEFAULT_MAX_ROUNDS = 3;
export const DEFAULT_MAX_NODES = 30;

const KNOWN_PHASES: readonly ComposePhase[] = ["INVESTIGATE", "PLAN", "IMPLEMENT", "CHECK", "DONE", "FAILED"];

function isPositiveInt(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v > 0;
}

function corruptState(ws: ComposeWorkspace, reason: string): Error {
  return new Error(`compose: corrupt state.json in ${ws.goalDir}: ${reason}`);
}

function parseState(raw: unknown, ws: ComposeWorkspace): ComposeState {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw corruptState(ws, "expected an object");
  }
  const s = raw as Record<string, unknown>;
  if (typeof s.goal !== "string") throw corruptState(ws, '"goal" must be a string');
  if (typeof s.state !== "string" || !KNOWN_PHASES.includes(s.state as ComposePhase)) {
    throw corruptState(ws, `unknown phase ${JSON.stringify(s.state)}`);
  }
  if (!isPositiveInt(s.round)) throw corruptState(ws, '"round" must be a positive integer');
  if (!isPositiveInt(s.maxRounds)) {
    throw corruptState(ws, '"maxRounds" must be a positive integer');
  }
  if (typeof s.testCmd !== "string") throw corruptState(ws, '"testCmd" must be a string');
  if (s.runs !== undefined) {
    if (!Array.isArray(s.runs)) throw corruptState(ws, '"runs" must be an array');
    for (const r of s.runs) {
      if (typeof r !== "object" || r === null) throw corruptState(ws, '"runs" entries must be objects');
      const run = r as Record<string, unknown>;
      if (typeof run.runId !== "string") throw corruptState(ws, '"runs" entries need a string runId');
      if (typeof run.phase !== "string" || !KNOWN_PHASES.includes(run.phase as ComposePhase)) {
        throw corruptState(ws, `"runs" entry has unknown phase ${JSON.stringify(run.phase)}`);
      }
      if (run.item !== undefined && !(typeof run.item === "number" && Number.isInteger(run.item) && run.item >= 0)) {
        throw corruptState(ws, '"runs" entry "item" must be a non-negative integer');
      }
    }
  }
  return s as unknown as ComposeState;
}

export function createState(goal: string, opts: { testCmd?: string; maxRounds?: number } = {}): ComposeState {
  return {
    goal,
    state: "INVESTIGATE",
    round: 1,
    testCmd: opts.testCmd ?? DEFAULT_TEST_CMD,
    maxRounds: opts.maxRounds ?? DEFAULT_MAX_ROUNDS,
  };
}

export async function loadState(ws: ComposeWorkspace): Promise<ComposeState | null> {
  if (!(await ws.exists(STATE_FILE))) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(await ws.read(STATE_FILE));
  } catch {
    throw corruptState(ws, "invalid JSON");
  }
  return parseState(raw, ws);
}

export async function saveState(ws: ComposeWorkspace, state: ComposeState): Promise<void> {
  await withLock(ws.filePath(STATE_FILE), () => ws.write(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`));
}
