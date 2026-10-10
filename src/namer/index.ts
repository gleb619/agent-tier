/**
 * Namer public surface — re-exports for callers that don't want to reach into
 * `providers/*` directly. Back-compat shim for the pre-T09 `runner.ts` import.
 */

export type { NamerProvider } from './types';
export { KNOWN_NAMER_PROVIDER_KINDS, type NamerProviderKind } from './types';
export {
  OllamaProvider,
  sanitizeName,
  NAMER_MIN_LEN,
  NAMER_MAX_LEN,
  NAMER_PROMPT_MAX_CHARS,
  DEFAULT_NAMER_MODEL,
  DEFAULT_NAMER_URL,
  DEFAULT_NAMER_TIMEOUT_MS,
  type NamerOptions,
} from './providers/ollama';
export {
  OpenRouterProvider,
  type OpenRouterOptions,
} from './providers/openrouter';
export {
  generateSessionName,
  type GenerateSessionNameOpts,
  type GenerateSessionNameResult,
} from './orchestrator';
export {
  loadNamerConfig,
  loadSecrets,
  resolveSecret,
} from './config';
export { buildProviders } from './registry';
export { DEFAULT_NAMER_CONFIG } from './default-config';