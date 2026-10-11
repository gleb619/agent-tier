/**
 * Namer public surface — re-exports for callers that don't want to reach into
 * `providers/*` directly. Back-compat shim for the pre-T09 `runner.ts` import.
 */

export {
  loadNamerConfig,
  loadSecrets,
  resolveSecret,
} from "./config";
export { DEFAULT_NAMER_CONFIG } from "./default-config";
export {
  type GenerateSessionNameOpts,
  type GenerateSessionNameResult,
  generateSessionName,
} from "./orchestrator";
export {
  DEFAULT_NAMER_MODEL,
  DEFAULT_NAMER_TIMEOUT_MS,
  DEFAULT_NAMER_URL,
  deriveName,
  NAMER_MAX_LEN,
  NAMER_MIN_LEN,
  NAMER_PROMPT_MAX_CHARS,
  NAMER_SALVAGE_MIN_LEN,
  type NamerOptions,
  OllamaProvider,
  sanitizeName,
} from "./providers/ollama";
export {
  type OpenRouterOptions,
  OpenRouterProvider,
} from "./providers/openrouter";
export { buildProviders } from "./registry";
export type { NamerProvider } from "./types";
export { KNOWN_NAMER_PROVIDER_KINDS, type NamerProviderKind } from "./types";
