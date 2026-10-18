import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { AgentDef } from "./agents/registry";
import { cachedState } from "./daemon-cache";
import { withLock } from "./lock";
import { brokerRunStore } from "./notify/daemon-sock";

export interface SchedulerState {
  index: number;
}

export interface RunsState {
  maxEntries?: number;
}

export interface StateFile {
  scheduler?: Record<string, SchedulerState>;
  runs?: RunsState;
}

export function loadStateFile(stateFilePath: string): StateFile {
  try {
    return JSON.parse(readFileSync(stateFilePath, "utf8"));
  } catch {
    return {};
  }
}

export function saveStateFile(stateFilePath: string, state: StateFile): void {
  mkdirSync(path.dirname(stateFilePath), { recursive: true });
  writeFileSync(stateFilePath, JSON.stringify(state, null, 2), "utf8");
}

export function getStateFile(stateDir: string): string {
  return path.join(stateDir, "state.json");
}

export async function pickAgent(agents: AgentDef[], stateFilePath: string, key = "default"): Promise<AgentDef> {
  // With the daemon up it owns the state.json advance, so concurrent `at`
  // processes cannot lose a round-robin step to each other. Absent or refusing
  // daemon falls through to the locked local path below.
  if (agents.length > 0) {
    const stateDir = path.dirname(stateFilePath);
    const brokered = await brokerRunStore(stateDir, "state.pick", {
      stateDir,
      stateFilePath,
      key,
      count: agents.length,
    });
    if (brokered) return agents[(brokered.data as { index: number }).index];
  }

  return withLock(stateFilePath, async () => {
    // Read through the daemon's state.json cache (fingerprint-checked, so as
    // fresh as the direct read); the advance below is still written directly.
    const cached =
      path.basename(stateFilePath) === "state.json" ? await cachedState(path.dirname(stateFilePath)) : null;
    const state = cached ?? loadStateFile(stateFilePath);
    if (!state.scheduler) state.scheduler = {};

    let sched: SchedulerState = { index: -1 };
    if (state.scheduler[key]) {
      sched = state.scheduler[key];
    }

    const nextIndex = (sched.index + 1) % agents.length;
    state.scheduler[key] = { index: nextIndex };
    saveStateFile(stateFilePath, state);
    return agents[nextIndex];
  });
}
