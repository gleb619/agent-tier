import { describe, it, expect } from 'vitest';
import { KNOWN_NAMER_PROVIDER_KINDS } from '../../src/namer/types';
import type { NamerProvider } from '../../src/namer/types';

describe('NamerProvider interface (T01)', () => {
  it('accepts a minimal implementation', () => {
    const provider: NamerProvider = {
      name: 'test',
      async isAvailable() { return true; },
      async generate() { return 'refactor-auth-middleware-please'; },
    };
    expect(provider.name).toBe('test');
  });

  it('supports optional async dispose', async () => {
    let disposed = false;
    const provider: NamerProvider = {
      name: 'with-dispose',
      async isAvailable() { return true; },
      async generate() { return null; },
      async dispose() { disposed = true; },
    };
    await provider.dispose?.();
    expect(disposed).toBe(true);
  });

  it('supports optional sync dispose', () => {
    const provider: NamerProvider = {
      name: 'sync-dispose',
      async isAvailable() { return true; },
      async generate() { return null; },
      dispose() { /* sync */ },
    };
    expect(typeof provider.dispose).toBe('function');
  });

  it('generate returns null for failure', async () => {
    const provider: NamerProvider = {
      name: 'fail',
      async isAvailable() { return true; },
      async generate() { return null; },
    };
    const out = await provider.generate('hi', new AbortController().signal);
    expect(out).toBeNull();
  });

  it('isAvailable can be false', async () => {
    const provider: NamerProvider = {
      name: 'unavailable',
      async isAvailable() { return false; },
      async generate() { return null; },
    };
    expect(await provider.isAvailable(new AbortController().signal)).toBe(false);
  });
});

describe('KNOWN_NAMER_PROVIDER_KINDS (T01 runtime constant)', () => {
  it('lists the three provider kinds from the plan', () => {
    expect(KNOWN_NAMER_PROVIDER_KINDS).toEqual([
      'ollama',
      'openrouter',
      'ollama-ssh-tunnel',
    ]);
  });

  it('is a readonly tuple usable in switch / includes checks', () => {
    expect(KNOWN_NAMER_PROVIDER_KINDS.includes('ollama')).toBe(true);
    expect(KNOWN_NAMER_PROVIDER_KINDS.includes('bogus')).toBe(false);
  });
});