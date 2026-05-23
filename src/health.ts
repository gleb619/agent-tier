import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import path from 'path';
import os from 'os';
import { AgentDef } from './agents/registry';

export interface AgentHealth {
  failureTimes: string[];
  disabledTo: string | null;
}

export interface HealthState {
  agents: Record<string, AgentHealth>;
}

export const STATE_FILE = path.join(os.homedir(), '.at', 'state.json');

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
  // Pick the highest threshold that count meets
  let ms = durations[0]?.[1] ?? 30 * 60 * 1000;
  for (const [threshold, duration] of durations) {
    if (count >= threshold) ms = duration;
  }
  return ms;
}

export function loadHealth(): HealthState {
  try {
    const data = readFileSync(STATE_FILE, 'utf8');
    return JSON.parse(data) as HealthState;
  } catch {
    return { agents: {} };
  }
}

export function saveHealth(state: HealthState): void {
  mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
}

export function recordResult(name: string, success: boolean): void {
  const state = loadHealth();

  if (success) {
    state.agents[name] = { failureTimes: [], disabledTo: null };
  } else {
    const current = state.agents[name] ?? { failureTimes: [], disabledTo: null };
    current.failureTimes = pruneOldFailures([...current.failureTimes, new Date().toISOString()]);
    current.disabledTo = null; // will re-evaluate below

    const count = current.failureTimes.length;
    if (count >= getThreshold()) {
      const duration = blockDurationFor(count);
      current.disabledTo = new Date(Date.now() + duration).toISOString();
    }
    state.agents[name] = current;
  }

  saveHealth(state);
}

export function isHealthy(name: string): boolean {
  const state = loadHealth();
  const entry = state.agents[name];

  if (!entry) return true;

  // Prune stale entries so the window stays accurate
  entry.failureTimes = pruneOldFailures(entry.failureTimes);
  if (entry.failureTimes.length === 0) {
    entry.disabledTo = null;
  }

  if (!entry.disabledTo) return true;

  return Date.now() >= new Date(entry.disabledTo).getTime();
}

export function filterHealthy(agents: AgentDef[]): AgentDef[] {
  return agents.filter((a) => isHealthy(a.name));
}

export function resetAgent(name: string): void {
  const state = loadHealth();
  state.agents[name] = { failureTimes: [], disabledTo: null };
  saveHealth(state);
}
