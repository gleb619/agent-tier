import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import path from 'path';
import { AgentDef } from './agents/registry';

export interface AgentHealth {
  failureTimes: string[];
  disabledTo: string | null;
  deactivated?: boolean;
}

export interface HealthState {
  agents: Record<string, AgentHealth>;
}

const DEFAULT_WINDOW_MS = 60 * 60 * 1000;       // 60 min
const DEFAULT_THRESHOLD = 3;
const DEFAULT_BLOCK_DURATIONS: [number, number][] = [
  [3, 30 * 60 * 1000],        // 3 failures → 30 min
  [5, 2 * 60 * 60 * 1000],    // 5 failures → 2h
  [7, 6 * 60 * 60 * 1000],    // 7 failures → 6h
];

function getWindowMs(): number {
  const env = process.env.AT_HEALTH_WINDOW_MS;
  return env ? Number(env) : DEFAULT_WINDOW_MS;
}

function getThreshold(): number {
  const env = process.env.AT_HEALTH_THRESHOLD;
  return env ? Number(env) : DEFAULT_THRESHOLD;
}

function getBlockDurations(): [number, number][] {
  const env = process.env.AT_HEALTH_BLOCK_DURATIONS;
  if (env) {
    try {
      return JSON.parse(env);
    } catch {
      return DEFAULT_BLOCK_DURATIONS;
    }
  }
  return DEFAULT_BLOCK_DURATIONS;
}

function pruneOldFailures(times: string[]): string[] {
  const cutoff = Date.now() - getWindowMs();
  return times.filter((t) => new Date(t).getTime() >= cutoff);
}

function blockDurationFor(count: number): number {
  const durations = getBlockDurations();
  let ms = durations[0]?.[1] ?? 30 * 60 * 1000;
  for (const [threshold, duration] of durations) {
    if (count >= threshold) ms = duration;
  }
  return ms;
}

export function loadHealth(stateFilePath: string): HealthState {
  try {
    const data = readFileSync(stateFilePath, 'utf8');
    const parsed = JSON.parse(data);
    return { agents: {}, ...parsed };
  } catch {
    return { agents: {} };
  }
}

export function saveHealth(stateFilePath: string, state: HealthState): void {
  mkdirSync(path.dirname(stateFilePath), { recursive: true });
  // Read existing full state file to preserve scheduler data
  let full: Record<string, unknown> = {};
  try {
    full = JSON.parse(readFileSync(stateFilePath, 'utf8'));
  } catch {
    // no file yet
  }
  // Merge health fields into the existing state
  full.agents = state.agents;
  writeFileSync(stateFilePath, JSON.stringify(full, null, 2), 'utf8');
}

export function isDeactivated(stateFilePath: string, name: string, preloaded?: HealthState): boolean {
  const state = preloaded ?? loadHealth(stateFilePath);
  return state.agents[name]?.deactivated === true;
}

export function setDeactivated(stateFilePath: string, name: string, deactivated: boolean): void {
  const state = loadHealth(stateFilePath);
  if (!state.agents[name]) {
    state.agents[name] = { failureTimes: [], disabledTo: null };
  }

  if (deactivated) {
    state.agents[name].deactivated = true;
  } else {
    delete state.agents[name].deactivated;
  }
  saveHealth(stateFilePath, state);
}

export function recordResult(stateFilePath: string, name: string, success: boolean): void {
  const state = loadHealth(stateFilePath);

  if (success) {
    state.agents[name] = { failureTimes: [], disabledTo: null };
  } else {
    const current = state.agents[name] ?? { failureTimes: [], disabledTo: null };
    current.failureTimes = pruneOldFailures([...current.failureTimes, new Date().toISOString()]);
    current.disabledTo = null;

    const count = current.failureTimes.length;
    if (count >= getThreshold()) {
      const duration = blockDurationFor(count);
      current.disabledTo = new Date(Date.now() + duration).toISOString();
    }
    state.agents[name] = current;
  }

  saveHealth(stateFilePath, state);
}

export function isHealthy(stateFilePath: string, name: string, preloaded?: HealthState): boolean {
  const state = preloaded ?? loadHealth(stateFilePath);
  const entry = state.agents[name];

  if (!entry) return true;

  entry.failureTimes = pruneOldFailures(entry.failureTimes);
  if (entry.failureTimes.length === 0) {
    entry.disabledTo = null;
  }

  if (!entry.disabledTo) return true;

  return Date.now() >= new Date(entry.disabledTo).getTime();
}

export function filterHealthy(stateFilePath: string, agents: AgentDef[], preloaded?: HealthState): AgentDef[] {
  return agents.filter((a) => isHealthy(stateFilePath, a.name, preloaded));
}

export function resetAgent(stateFilePath: string, name: string): void {
  const state = loadHealth(stateFilePath);
  state.agents[name] = { failureTimes: [], disabledTo: null };
  saveHealth(stateFilePath, state);
}
