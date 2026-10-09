import { describe, it, expect, vi } from 'vitest';
import { buildProviders } from '../../src/namer/registry';
import { OllamaProvider } from '../../src/namer/providers/ollama';
import { OpenRouterProvider } from '../../src/namer/providers/openrouter';
import { OllamaSshTunnelProvider } from '../../src/namer/providers/ollama-ssh-tunnel';
import type { NamerConfig } from '../../src/namer/types';

const openTunnel = vi.fn(async () => ({
  localUrl: 'http://127.0.0.1:5555',
  close: vi.fn(async () => {}),
}));

describe('buildProviders', () => {
  it('returns empty array for empty providers list', async () => {
    const list = await buildProviders({ providers: [] }, {}, { openTunnel });
    expect(list).toEqual([]);
  });

  it('instantiates OllamaProvider for type=ollama', async () => {
    const cfg: NamerConfig = {
      providers: [
        { name: 'local', type: 'ollama', url: 'http://x', model: 'm', timeoutMs: 1000 },
      ],
    };
    const list = await buildProviders(cfg, {}, { openTunnel });
    expect(list).toHaveLength(1);
    expect(list[0]).toBeInstanceOf(OllamaProvider);
    expect(list[0]!.name).toBe('local');
  });

  it('instantiates OpenRouterProvider with apiKey resolved from secrets', async () => {
    const cfg: NamerConfig = {
      providers: [
        { name: 'or', type: 'openrouter', url: 'https://or', model: 'm', apiKeyRef: 'openrouter', timeoutMs: 1000 },
      ],
    };
    const list = await buildProviders(cfg, { openrouter: 'sk-or-v1-abc' }, { openTunnel });
    expect(list[0]).toBeInstanceOf(OpenRouterProvider);
    // isAvailable true means the key was wired in
    expect(await (list[0] as OpenRouterProvider).isAvailable(new AbortController().signal)).toBe(true);
  });

  it('OpenRouterProvider isAvailable false when apiKeyRef missing from secrets', async () => {
    const cfg: NamerConfig = {
      providers: [
        { name: 'or', type: 'openrouter', url: 'https://or', model: 'm', apiKeyRef: 'openrouter', timeoutMs: 1000 },
      ],
    };
    const list = await buildProviders(cfg, {}, { openTunnel });
    expect(await (list[0] as OpenRouterProvider).isAvailable(new AbortController().signal)).toBe(false);
  });

  it('OpenRouterProvider falls back to env when secrets missing', async () => {
    const cfg: NamerConfig = {
      providers: [
        { name: 'or', type: 'openrouter', url: 'https://or', model: 'm', apiKeyRef: 'openrouter', timeoutMs: 1000 },
      ],
    };
    const previous = process.env.OPENROUTER;
    process.env.OPENROUTER = 'env-key';
    try {
      const list = await buildProviders(cfg, {}, { openTunnel });
      expect(await (list[0] as OpenRouterProvider).isAvailable(new AbortController().signal)).toBe(true);
    } finally {
      if (previous === undefined) delete process.env.OPENROUTER;
      else process.env.OPENROUTER = previous;
    }
  });

  it('instantiates OllamaSshTunnelProvider for type=ollama-ssh-tunnel', async () => {
    const cfg: NamerConfig = {
      providers: [
        {
          name: 'b3',
          type: 'ollama-ssh-tunnel',
          ssh: { host: 'borispc3.ai', user: 'boris', identityFile: '~/.ssh/id_rsa' },
          remoteUrl: 'http://127.0.0.1:11434',
          model: 'gemma3:1b',
          timeoutMs: 4000,
        },
      ],
    };
    const list = await buildProviders(cfg, {}, { openTunnel });
    expect(list[0]).toBeInstanceOf(OllamaSshTunnelProvider);
  });

  it('does NOT open the tunnel during buildProviders (lazy)', async () => {
    const cfg: NamerConfig = {
      providers: [
        {
          name: 'b3',
          type: 'ollama-ssh-tunnel',
          ssh: { host: 'borispc3.ai', user: 'boris' },
          remoteUrl: 'http://127.0.0.1:11434',
          model: 'm',
          timeoutMs: 1000,
        },
      ],
    };
    openTunnel.mockClear();
    await buildProviders(cfg, {}, { openTunnel });
    expect(openTunnel).not.toHaveBeenCalled();
  });

  it('preserves provider order from config', async () => {
    const cfg: NamerConfig = {
      providers: [
        { name: 'first', type: 'ollama', url: 'http://x', model: 'm', timeoutMs: 1000 },
        { name: 'second', type: 'ollama', url: 'http://y', model: 'm', timeoutMs: 1000 },
        { name: 'third', type: 'ollama', url: 'http://z', model: 'm', timeoutMs: 1000 },
      ],
    };
    const list = await buildProviders(cfg, {}, { openTunnel });
    expect(list.map((p) => p.name)).toEqual(['first', 'second', 'third']);
  });
});