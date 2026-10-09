/**
 * Provider registry (T07) — instantiate `NamerProvider`s from a `NamerConfig`.
 *
 * Each provider kind:
 *  - `ollama`             → `OllamaProvider`
 *  - `openrouter`         → `OpenRouterProvider` (apiKey resolved by `resolveSecret`)
 *  - `ollama-ssh-tunnel`  → `OllamaSshTunnelProvider` (tunnel opened lazily on
 *                           first `isAvailable()`, not here)
 *
 * Order is preserved. Unknown kinds are skipped (config validator already
 * drops them at load time, so this is defensive).
 */

import type { NamerProvider } from './types';
import type { NamerConfig } from './types';
import { OllamaProvider } from './providers/ollama';
import { OpenRouterProvider } from './providers/openrouter';
import { OllamaSshTunnelProvider } from './providers/ollama-ssh-tunnel';
import { openSshTunnel, type SshTunnelHandle } from './ssh-tunnel';
import { resolveSecret } from './config';

export interface BuildProvidersDeps {
  openTunnel?: typeof openSshTunnel;
}

export async function buildProviders(
  config: NamerConfig,
  secrets: Record<string, string> = {},
  deps: BuildProvidersDeps = {},
): Promise<NamerProvider[]> {
  const openTunnel = deps.openTunnel ?? openSshTunnel;
  const out: NamerProvider[] = [];
  for (const pc of config.providers) {
    const provider = instantiate(pc, secrets, openTunnel);
    if (provider) out.push(provider);
  }
  return out;
}

function instantiate(
  pc: NamerConfig['providers'][number],
  secrets: Record<string, string>,
  openTunnel: (opts: Parameters<typeof openSshTunnel>[0]) => Promise<SshTunnelHandle>,
): NamerProvider | null {
  if (pc.type === 'ollama') {
    return new OllamaProvider({
      name: pc.name,
      url: pc.url,
      model: pc.model,
      timeoutMs: pc.timeoutMs,
    });
  }
  if (pc.type === 'openrouter') {
    const apiKey = pc.apiKeyRef ? resolveSecret(pc.apiKeyRef, secrets) : undefined;
    return new OpenRouterProvider({
      name: pc.name,
      url: pc.url,
      model: pc.model,
      apiKey,
      timeoutMs: pc.timeoutMs,
    });
  }
  if (pc.type === 'ollama-ssh-tunnel') {
    return new OllamaSshTunnelProvider({
      name: pc.name,
      ssh: pc.ssh,
      remoteUrl: pc.remoteUrl,
      model: pc.model,
      timeoutMs: pc.timeoutMs,
      openTunnel,
    });
  }
  return null;
}