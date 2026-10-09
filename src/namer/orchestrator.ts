/**
 * Orchestrator (T08) — `generateSessionName` walks providers in order,
 * first success wins, falls back to a deterministic placeholder.
 *
 * Total wall-time is capped by the slowest provider timeout (~12 s for the
 * 3 defaults). Callers (T09) intentionally do NOT await — the result lands
 * asynchronously on `updateRun`.
 */

import type { NamerProvider } from './types';
import { loadNamerConfig, loadSecrets } from './config';
import { buildProviders } from './registry';
import { DEFAULT_NAMER_CONFIG } from './default-config';

export interface GenerateSessionNameOpts {
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  /** Injectable providers — bypasses config + secrets loading. Used by tests. */
  providers?: NamerProvider[];
  /** Injectable fallback name — bypasses config (defaults to `unnamed`). */
  fallbackName?: string;
  /** Injectable config loader — used by tests. */
  loadConfig?: typeof loadNamerConfig;
  /** Injectable secrets loader — used by tests. */
  loadSecrets?: typeof loadSecrets;
  /** Injectable provider builder — used by tests. */
  buildProviders?: typeof buildProviders;
}

export interface GenerateSessionNameResult {
  name: string;
  provider: string | null;
}

export async function generateSessionName(
  prompt: string,
  stateDir: string,
  opts: GenerateSessionNameOpts = {},
): Promise<GenerateSessionNameResult> {
  const fallbackName = opts.fallbackName ?? DEFAULT_NAMER_CONFIG.fallbackName ?? 'unnamed';

  let providers: NamerProvider[];
  let ownsProviders: boolean;
  if (opts.providers) {
    providers = opts.providers;
    ownsProviders = false;
  } else {
    const loadCfg = opts.loadConfig ?? loadNamerConfig;
    const loadSec = opts.loadSecrets ?? loadSecrets;
    const build = opts.buildProviders ?? buildProviders;
    const [cfg, secrets] = await Promise.all([loadCfg(stateDir), loadSec(stateDir)]);
    providers = await build(cfg, secrets);
    ownsProviders = true;
  }

  if (providers.length === 0) {
    return { name: fallbackName, provider: null };
  }

  let result: GenerateSessionNameResult = { name: fallbackName, provider: null };
  try {
    for (const provider of providers) {
      try {
        const available = await provider.isAvailable(opts.signal ?? new AbortController().signal);
        if (!available) {
          console.warn(`[at] namer: provider ${provider.name} unavailable, skipping`);
          continue;
        }
        const raw = await provider.generate(prompt, opts.signal ?? new AbortController().signal);
        if (typeof raw === 'string' && raw.length > 0) {
          console.warn(`[at] namer: named via ${provider.name}`);
          result = { name: raw, provider: provider.name };
          break;
        }
      } catch (err) {
        console.warn(`[at] namer: provider ${provider.name} threw: ${(err as Error).message}; skipping`);
      }
    }

    if (result.provider === null) {
      console.warn(`[at] namer: all providers failed, using fallback "${fallbackName}"`);
    }
  } finally {
    if (ownsProviders) {
      for (const p of providers) {
        try {
          if (typeof p.dispose === 'function') {
            await p.dispose();
          }
        } catch {
          /* swallow individual dispose errors — never block the result */
        }
      }
    }
  }

  return result;
}