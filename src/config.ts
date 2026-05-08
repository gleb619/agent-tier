import { createHmac } from 'crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import path from 'path';
import os from 'os';
import { AgentDef } from './agents/registry';

export interface AtConfig {
  tierOverrides?: Record<string, 1 | 2 | 3>;
}

const CONFIG_DIR = path.join(os.homedir(), '.at');
export const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
export const HMAC_FILE = path.join(CONFIG_DIR, 'config.json.hmac');
const HMAC_ALGO = 'sha256';

export function getSecret(): string {
  return process.env.AT_HMAC_SECRET ?? 'at-config-hmac-v1';
}

export function computeHmac(data: string): string {
  return createHmac(HMAC_ALGO, getSecret()).update(data, 'utf8').digest('hex');
}

export function signConfig(): void {
  const data = readFileSync(CONFIG_FILE, 'utf8');
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(HMAC_FILE, computeHmac(data), 'utf8');
  console.log(`[at] config signed: ${HMAC_FILE}`);
}

export function loadConfig(): AtConfig | null {
  let data: string;
  try {
    data = readFileSync(CONFIG_FILE, 'utf8');
  } catch {
    return null;
  }

  let storedHmac: string;
  try {
    storedHmac = readFileSync(HMAC_FILE, 'utf8').trim();
  } catch {
    console.warn('[at] ~/.at/config.json found but no HMAC — ignoring. Run: at config sign');
    return null;
  }

  if (storedHmac !== computeHmac(data)) {
    console.error('[at] config HMAC mismatch — config may be tampered. Run: at config sign');
    return null;
  }

  try {
    return JSON.parse(data) as AtConfig;
  } catch {
    console.error('[at] ~/.at/config.json is not valid JSON');
    return null;
  }
}

export function applyTierOverrides(agents: AgentDef[], config: AtConfig | null): AgentDef[] {
  if (!config?.tierOverrides) return agents;
  return agents.map((a) => {
    const override = config.tierOverrides![a.name];
    return override !== undefined ? { ...a, tier: override } : a;
  });
}
