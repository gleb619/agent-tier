/**
 * Orchestrator (T08) — `generateSessionName` walks providers in order,
 * first success wins, falls back to a deterministic placeholder.
 *
 * Total wall-time is capped by the slowest provider timeout (~12 s for the
 * 3 defaults). Callers await the result and persist it via `updateRun`;
 * extra reflective context (run log tail) rides along in `opts.context`.
 */

import type { NamerProvider } from './types';
import { loadNamerConfig, loadSecrets } from './config';
import { buildProviders } from './registry';
import { DEFAULT_NAMER_CONFIG } from './default-config';
import { NAMER_PROMPT_MAX_CHARS } from './providers/ollama';

export interface GenerateSessionNameOpts {
  signal?: AbortSignal;
  /**
   * Extra reflective context (e.g. a run log tail) concatenated into the
   * provider prompt after the original prompt. Truncated, together with the
   * prompt, to NAMER_PROMPT_MAX_CHARS.
   */
  context?: string;
  /** Suppress console.warn diagnostics — callers with strict stderr (status --json). */
  quiet?: boolean;
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
  const warn = (...args: unknown[]): void => {
    if (!opts.quiet) console.warn(...args);
  };

  let providers: NamerProvider[];
  if (opts.providers) {
    providers = opts.providers;
  } else {
    const loadCfg = opts.loadConfig ?? loadNamerConfig;
    const loadSec = opts.loadSecrets ?? loadSecrets;
    const build = opts.buildProviders ?? buildProviders;
    const [cfg, secrets] = await Promise.all([loadCfg(stateDir), loadSec(stateDir)]);
    providers = build(cfg, secrets);
  }

  if (providers.length === 0) {
    return { name: fallbackName, provider: null };
  }

  // Reflective naming: the caller may attach run output (log tail) as context.
  // Head-truncate like the ollama provider does — the prompt leads, context
  // follows, and nothing beyond NAMER_PROMPT_MAX_CHARS reaches a provider.
  let effectivePrompt = prompt;
  if (opts.context && opts.context.trim()) {
    const combined = `${prompt}\n\n${opts.context}`;
    effectivePrompt =
      combined.length > NAMER_PROMPT_MAX_CHARS ? combined.slice(0, NAMER_PROMPT_MAX_CHARS) : combined;
  }

  let result: GenerateSessionNameResult = { name: fallbackName, provider: null };
  for (const provider of providers) {
    try {
      const available = await provider.isAvailable(opts.signal ?? new AbortController().signal);
      if (!available) {
        warn(`[at] namer: provider ${provider.name} unavailable, skipping`);
        continue;
      }
      const raw = await provider.generate(effectivePrompt, opts.signal ?? new AbortController().signal);
      if (typeof raw === 'string' && raw.length > 0) {
        warn(`[at] namer: named via ${provider.name}`);
        result = { name: raw, provider: provider.name };
        break;
      }
    } catch (err) {
      warn(`[at] namer: provider ${provider.name} threw: ${(err as Error).message}; skipping`);
    }
  }

  if (result.provider === null) {
    warn(`[at] namer: all providers failed, using fallback "${fallbackName}"`);
  }

  return result;
}