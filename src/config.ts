import { createHmac } from 'crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import path from 'path';
import os from 'os';
import { AgentDef } from './agents/registry';

export interface AtConfig {
  tierOverrides?: Record<string, 1 | 2 | 3>;
  /**
   * Ordered list of agent names used when `at` runs in line mode (no `-t`
   * flag). Names not in the registry are skipped with a warning; duplicates
   * are deduped (first occurrence wins). An empty resolved line (all names
   * unknown) is an error.
   */
  line?: string[];
  /** Optional sandbox-test settings. Opt-in via `--sandbox` or `enabled: true`. */
  sandbox?: { enabled?: boolean; prompt?: string; timeoutMs?: number };
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
  if (!process.env.AT_HMAC_SECRET) {
    console.warn('[at] warning: AT_HMAC_SECRET not set — config HMAC uses default secret. Set AT_HMAC_SECRET for real integrity protection.');
  }
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

  if (!process.env.AT_HMAC_SECRET) {
    console.warn('[at] warning: AT_HMAC_SECRET not set — config HMAC uses default secret. Set AT_HMAC_SECRET for real integrity protection.');
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

/**
 * Resolve the line-mode agent queue. When `config.line` is present, names are
 * resolved against the *passed* agents array (so runner-supplied agents are
 * honoured, not the global AGENTS list). When absent, defaults to all
 * non-tier-4 agents sorted by tier ascending (3, 2, 1) — `Array.prototype.sort`
 * is stable, so registry order is preserved within a tier.
 *
 * Empty result (all names unknown / only mocks) throws.
 */
export function getLineAgents(agents: AgentDef[], config: AtConfig | null): AgentDef[] {
  const byName = new Map(agents.map((a) => [a.name, a]));

  if (config?.line) {
    const seen = new Set<string>();
    const resolved: AgentDef[] = [];
    for (const name of config.line) {
      if (seen.has(name)) continue;
      const a = byName.get(name);
      if (!a) {
        console.warn(`[at] line: unknown agent "${name}" skipped`);
        continue;
      }
      seen.add(name);
      resolved.push(a);
    }
    if (resolved.length === 0) {
      throw new Error('line config is empty — add agents with: at line add <agent>');
    }
    return resolved;
  }

  // Default: all non-tier-4, tier ascending (3 first, then 2, then 1).
  // Array.prototype.sort is stable, so within a tier the registry order is kept.
  const defaultOrder: Array<1 | 2 | 3> = [3, 2, 1];
  const result = agents
    .filter((a): a is AgentDef & { tier: 1 | 2 | 3 } => a.tier !== 4)
    .sort((x, y) => defaultOrder.indexOf(x.tier) - defaultOrder.indexOf(y.tier));

  if (result.length === 0) {
    throw new Error('line config is empty — add agents with: at line add <agent>');
  }
  return result;
}
