/**
 * Namer public surface — re-exports for callers that don't want to reach into
 * `providers/*` directly. Back-compat shim for the pre-T09 `runner.ts` import.
 */

export type { NamerProvider } from './types';
export { KNOWN_NAMER_PROVIDER_KINDS, type NamerProviderKind } from './types';
export {
  OllamaProvider,
  sanitizeName,
  generateSessionName,
  NAMER_MIN_LEN,
  NAMER_MAX_LEN,
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
  OllamaSshTunnelProvider,
  type OllamaSshTunnelOptions,
} from './providers/ollama-ssh-tunnel';