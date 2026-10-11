/**
 * Provider registry (T07) — instantiate `NamerProvider`s from a `NamerConfig`.
 *
 * Each provider kind:
 *  - `ollama`      → `OllamaProvider`
 *  - `openrouter`  → `OpenRouterProvider` (apiKey resolved by `resolveSecret`)
 *
 * Order is preserved. Unknown kinds are skipped (config validator already
 * drops them at load time, so this is defensive).
 */

import { resolveSecret } from "./config";
import { OllamaProvider } from "./providers/ollama";
import { OpenRouterProvider } from "./providers/openrouter";
import type { NamerConfig, NamerProvider } from "./types";

export function buildProviders(config: NamerConfig, secrets: Record<string, string> = {}): NamerProvider[] {
  const out: NamerProvider[] = [];
  for (const pc of config.providers) {
    const provider = instantiate(pc, secrets);
    if (provider) out.push(provider);
  }
  return out;
}

function instantiate(pc: NamerConfig["providers"][number], secrets: Record<string, string>): NamerProvider | null {
  if (pc.type === "ollama") {
    return new OllamaProvider({
      name: pc.name,
      url: pc.url,
      model: pc.model,
      timeoutMs: pc.timeoutMs,
    });
  }
  if (pc.type === "openrouter") {
    const apiKey = pc.apiKeyRef ? resolveSecret(pc.apiKeyRef, secrets) : undefined;
    return new OpenRouterProvider({
      name: pc.name,
      url: pc.url,
      model: pc.model,
      apiKey,
      timeoutMs: pc.timeoutMs,
    });
  }
  return null;
}
