import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import path from 'path';
import os from 'os';
import { AgentDef } from './agents/registry';

export interface AgentHealth {
  failures: number;
  disabledAt: string | null;
}

export interface HealthState {
  agents: Record<string, AgentHealth>;
}

export const STATE_FILE = path.join(os.homedir(), '.at', 'state.json');

const DEFAULT_COOLDOWN_MS = 365 * 24 * 60 * 60 * 1000;
const DEFAULT_THRESHOLD = 3;

function getCooldown(): number {
  const env = process.env.AT_HEALTH_COOLDOWN_MS;
  return env ? Number(env) : DEFAULT_COOLDOWN_MS;
}

function getThreshold(): number {
  const env = process.env.AT_HEALTH_THRESHOLD;
  return env ? Number(env) : DEFAULT_THRESHOLD;
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
    state.agents[name] = { failures: 0, disabledAt: null };
  } else {
    const current = state.agents[name] ?? { failures: 0, disabledAt: null };
    current.failures += 1;
    if (current.failures >= getThreshold() && !current.disabledAt) {
      current.disabledAt = new Date().toISOString();
    }
    state.agents[name] = current;
  }

  saveHealth(state);
}

export function isHealthy(name: string): boolean {
  const state = loadHealth();
  const entry = state.agents[name];

  if (!entry) return true;
  if (entry.failures < getThreshold()) return true;
  if (!entry.disabledAt) return true;

  return Date.now() - new Date(entry.disabledAt).getTime() > getCooldown();
}

export function filterHealthy(agents: AgentDef[]): AgentDef[] {
  return agents.filter((a) => isHealthy(a.name));
}

export function resetAgent(name: string): void {
  const state = loadHealth();
  state.agents[name] = { failures: 0, disabledAt: null };
  saveHealth(state);
}
