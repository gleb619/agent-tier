import { describe, it, expect } from 'vitest';
import { buildProviders } from '../../src/namer/registry';
import { OllamaProvider } from '../../src/namer/providers/ollama';
import { OpenRouterProvider } from '../../src/namer/providers/openrouter';
import type { NamerConfig } from '../../src/namer/types';

describe('buildProviders', () => {
  it('returns empty array for empty providers list', () => {
    const list = buildProviders({ providers: [] }, {});
    expect(list).toEqual([]);
  });

  it('instantiates OllamaProvider for type=ollama', () => {
    const cfg: NamerConfig = {
      providers: [
        { name: 'local', type: 'ollama', url: 'http://x', model: 'm', timeoutMs: 1000 },
      ],
    };
    const list = buildProviders(cfg, {});
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
    const list = buildProviders(cfg, { openrouter: 'sk-or-v1-abc' });
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
    const list = buildProviders(cfg, {});
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
      const list = buildProviders(cfg, {});
      expect(await (list[0] as OpenRouterProvider).isAvailable(new AbortController().signal)).toBe(true);
    } finally {
      if (previous === undefined) delete process.env.OPENROUTER;
      else process.env.OPENROUTER = previous;
    }
  });

  it('defaults secrets to an empty map', async () => {
    const cfg: NamerConfig = {
      providers: [
        { name: 'or', type: 'openrouter', url: 'https://or', model: 'm', apiKeyRef: 'openrouter', timeoutMs: 1000 },
      ],
    };
    const previous = process.env.OPENROUTER;
    delete process.env.OPENROUTER;
    try {
      const list = buildProviders(cfg);
      expect(list).toHaveLength(1);
      expect(await (list[0] as OpenRouterProvider).isAvailable(new AbortController().signal)).toBe(false);
    } finally {
      if (previous !== undefined) process.env.OPENROUTER = previous;
    }
  });

  it('skips entries with an unknown type (defensive — validator drops them first)', () => {
    const cfg = {
      providers: [
        { name: 'good', type: 'ollama', url: 'http://x', model: 'm', timeoutMs: 1000 },
        { name: 'legacy', type: 'ollama-ssh-tunnel', remoteUrl: 'http://y', model: 'm', timeoutMs: 1000 },
      ],
    } as unknown as NamerConfig;
    const list = buildProviders(cfg, {});
    expect(list.map((p) => p.name)).toEqual(['good']);
  });

  it('preserves provider order from config', () => {
    const cfg: NamerConfig = {
      providers: [
        { name: 'first', type: 'ollama', url: 'http://x', model: 'm', timeoutMs: 1000 },
        { name: 'second', type: 'ollama', url: 'http://y', model: 'm', timeoutMs: 1000 },
        { name: 'third', type: 'ollama', url: 'http://z', model: 'm', timeoutMs: 1000 },
      ],
    };
    const list = buildProviders(cfg, {});
    expect(list.map((p) => p.name)).toEqual(['first', 'second', 'third']);
  });
});
