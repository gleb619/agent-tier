/**
 * Embedded single-provider default used when `~/.at/namer.json` is missing
 * or corrupt. Matches the pre-T02 behaviour (one local-ollama instance,
 * gemma3:1b, 3s timeout) so users who never touched the config file get the
 * same names as before.
 */

import type { NamerConfig } from './types';

export const DEFAULT_NAMER_CONFIG: NamerConfig = {
  providers: [
    {
      name: 'local-ollama',
      type: 'ollama',
      url: 'http://localhost:11434',
      model: 'gemma3:1b',
      timeoutMs: 3000,
    },
  ],
  fallbackName: 'unnamed',
};