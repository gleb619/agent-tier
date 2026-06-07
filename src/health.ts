import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import path from 'path';
import { AgentDef } from './agents/registry';
import { withLock } from './lock';

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

function pruneEntry(entry: AgentHealth): { pruned: AgentHealth; dirty: boolean } {
  const failureTimes = pruneOldFailures(entry.failureTimes);
  const disabledTo = failureTimes.length === 0 ? null : entry.disabledTo;
  const dirty = failureTimes.length !== entry.failureTimes.length || disabledTo !== entry.disabledTo;
  return { pruned: { ...entry, failureTimes, disabledTo }, dirty };
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

export async function setDeactivated(stateFilePath: string, name: string, deactivated: boolean): Promise<void> {
  return withLock(stateFilePath, () => {
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
  });
}

export async function recordResult(stateFilePath: string, name: string, success: boolean): Promise<void> {
  return withLock(stateFilePath, () => {
    const state = loadHealth(stateFilePath);

    if (success) {
      const current = state.agents[name] ?? { failureTimes: [], disabledTo: null };
      current.failureTimes = pruneOldFailures(current.failureTimes);
      current.disabledTo = null;
      state.agents[name] = current;
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
  });
}

export async function isHealthy(stateFilePath: string, name: string, preloaded?: HealthState): Promise<boolean> {
  const state = preloaded ?? loadHealth(stateFilePath);
  const raw = state.agents[name];
  if (!raw || !raw.failureTimes) return true;

  const { pruned, dirty } = pruneEntry(raw);

  if (dirty) {
    const updated: HealthState = { ...state, agents: { ...state.agents, [name]: pruned } };
    await withLock(stateFilePath, () => saveHealth(stateFilePath, updated));
  }

  if (!pruned.disabledTo) return true;

  return Date.now() >= new Date(pruned.disabledTo).getTime();
}

export async function filterHealthy(stateFilePath: string, agents: AgentDef[], preloaded?: HealthState): Promise<AgentDef[]> {
  let state = preloaded ?? loadHealth(stateFilePath);
  let dirty = false;

  for (const a of agents) {
    const raw = state.agents[a.name];
    if (!raw || !raw.failureTimes) continue;

    const { pruned, dirty: d } = pruneEntry(raw);
    if (d) {
      state = { ...state, agents: { ...state.agents, [a.name]: pruned } };
      dirty = true;
    }
  }

  if (dirty) {
    await withLock(stateFilePath, () => saveHealth(stateFilePath, state));
  }

  return agents.filter(a => {
    const entry = state.agents[a.name];
    if (!entry || !entry.disabledTo) return true;
    return Date.now() >= new Date(entry.disabledTo).getTime();
  });
}

export async function resetAgent(stateFilePath: string, name: string): Promise<void> {
  return withLock(stateFilePath, () => {
    const state = loadHealth(stateFilePath);
    state.agents[name] = { failureTimes: [], disabledTo: null };
    saveHealth(stateFilePath, state);
  });
}
