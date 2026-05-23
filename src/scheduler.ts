import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import path from 'path';
import { AgentDef } from './agents/registry';

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
    return JSON.parse(readFileSync(stateFilePath, 'utf8'));
  } catch {
    return {};
  }
}

export function saveStateFile(stateFilePath: string, state: StateFile): void {
  mkdirSync(path.dirname(stateFilePath), { recursive: true });
  writeFileSync(stateFilePath, JSON.stringify(state, null, 2), 'utf8');
}

export function getStateFile(_tier: number, stateDir: string, prefix = 'at'): string {
  // Kept for API compat but now returns the single state.json path
  void _tier;
  void prefix;
  return path.join(stateDir, 'state.json');
}

export function pickAgent(agents: AgentDef[], stateFilePath: string, key = 'default'): AgentDef {
  const state = loadStateFile(stateFilePath);
  if (!state.scheduler) state.scheduler = {};

  let sched: SchedulerState = { index: -1 };
  if (state.scheduler[key]) {
    sched = state.scheduler[key];
  }

  const nextIndex = (sched.index + 1) % agents.length;
  state.scheduler[key] = { index: nextIndex };
  saveStateFile(stateFilePath, state);
  return agents[nextIndex];
}
