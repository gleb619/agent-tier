/**
 * Namer provider interface — T01.
 *
 * Each namer is an object that knows its own health (`isAvailable`) and how to
 * produce a 20–40 char kebab-case session name (`generate`). The orchestrator
 * (T08) calls them sequentially, first success wins; never throws — return
 * `null` on failure so the orchestrator can fall through to the next provider.
 */

export interface NamerProvider {
  /** Stable identifier (e.g. `'boris3pc'`, `'openrouter'`, `'local-ollama'`). */
  readonly name: string;
  /** Cheap health probe; called sequentially before generate. */
  isAvailable(signal: AbortSignal): Promise<boolean>;
  /** Return 20–40 char kebab name or null. Never throws. */
  generate(prompt: string, signal: AbortSignal): Promise<string | null>;
}

/**
 * Runtime-usable tuple of provider `type` strings known to the loader /
 * registry. Keep in sync with `NamerProviderConfig['type']` in T06.
 */
export const KNOWN_NAMER_PROVIDER_KINDS = [
  'ollama',
  'openrouter',
] as const;

export type NamerProviderKind = (typeof KNOWN_NAMER_PROVIDER_KINDS)[number];

/** Discriminated provider config — `type` selects which fields apply. */
export type NamerProviderConfig =
  | NamerOllamaConfig
  | NamerOpenRouterConfig;

export interface NamerOllamaConfig {
  name: string;
  type: 'ollama';
  url: string;
  model: string;
  timeoutMs?: number;
}

export interface NamerOpenRouterConfig {
  name: string;
  type: 'openrouter';
  url: string;
  model: string;
  apiKeyRef?: string;
  timeoutMs?: number;
}

export interface NamerConfig {
  providers: NamerProviderConfig[];
  fallbackName?: string;
}