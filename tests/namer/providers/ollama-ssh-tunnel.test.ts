import { describe, it, expect, vi } from 'vitest';
import { OllamaSshTunnelProvider } from '../../../src/namer/providers/ollama-ssh-tunnel';
import type { SshTunnelHandle } from '../../../src/namer/ssh-tunnel';

interface CapturedCall {
  url: string;
  init: RequestInit;
}

function makeCapturingFetch(responder: (url: string) => Response): {
  fetchImpl: typeof fetch;
  captured: CapturedCall[];
} {
  const captured: CapturedCall[] = [];
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    captured.push({ url: String(url), init: init ?? {} });
    return responder(String(url));
  });
  return { fetchImpl: fetchImpl as unknown as typeof fetch, captured };
}

function okResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

function errorResponse(status = 500): Response {
  return { ok: false, status, json: async () => ({}) } as unknown as Response;
}

function makeFakeTunnel(localUrl = 'http://127.0.0.1:35421'): { handle: SshTunnelHandle; closed: { value: boolean } } {
  const closed = { value: false };
  const handle: SshTunnelHandle = {
    localUrl,
    close: vi.fn(async () => { closed.value = true; }),
  };
  return { handle, closed };
}

const baseOpts = {
  name: 'boris3pc',
  ssh: { host: 'borispc3.ai', user: 'boris', identityFile: '~/.ssh/id_rsa' },
  remoteUrl: 'http://127.0.0.1:11434',
  model: 'gemma3:1b',
};

describe('OllamaSshTunnelProvider', () => {
  it('exposes a stable name', () => {
    const { handle } = makeFakeTunnel();
    const p = new OllamaSshTunnelProvider({
      ...baseOpts,
      fetchImpl: vi.fn() as unknown as typeof fetch,
      openTunnel: vi.fn(async () => handle),
    });
    expect(p.name).toBe('boris3pc');
  });

  it('isAvailable opens the tunnel and probes /api/tags', async () => {
    const { handle, closed } = makeFakeTunnel('http://1.2.3.4:5555');
    const openTunnel = vi.fn(async () => handle);
    const { fetchImpl, captured } = makeCapturingFetch((url) =>
      url.includes('/api/tags') ? okResponse({ models: [] }) : errorResponse(404),
    );
    const p = new OllamaSshTunnelProvider({ ...baseOpts, fetchImpl, openTunnel });
    expect(await p.isAvailable(new AbortController().signal)).toBe(true);
    expect(openTunnel).toHaveBeenCalledTimes(1);
    expect(openTunnel).toHaveBeenCalledWith({
      host: 'borispc3.ai',
      user: 'boris',
      identityFile: '~/.ssh/id_rsa',
      remoteHost: '127.0.0.1',
      remotePort: 11434,
    });
    expect(captured[0]!.url).toBe('http://1.2.3.4:5555/api/tags');
    expect(closed.value).toBe(false);
  });

  it('isAvailable returns false when tunnel open throws', async () => {
    const openTunnel = vi.fn(async () => { throw new Error('ssh connection refused'); });
    const p = new OllamaSshTunnelProvider({
      ...baseOpts,
      fetchImpl: vi.fn() as unknown as typeof fetch,
      openTunnel,
    });
    expect(await p.isAvailable(new AbortController().signal)).toBe(false);
  });

  it('isAvailable returns false when /api/tags returns non-2xx', async () => {
    const { handle } = makeFakeTunnel();
    const openTunnel = vi.fn(async () => handle);
    const { fetchImpl } = makeCapturingFetch(() => errorResponse(503));
    const p = new OllamaSshTunnelProvider({ ...baseOpts, fetchImpl, openTunnel });
    expect(await p.isAvailable(new AbortController().signal)).toBe(false);
  });

  it('isAvailable caches the tunnel across calls', async () => {
    const { handle } = makeFakeTunnel();
    const openTunnel = vi.fn(async () => handle);
    const { fetchImpl } = makeCapturingFetch((url) =>
      url.includes('/api/tags') ? okResponse({ models: [] }) : errorResponse(404),
    );
    const p = new OllamaSshTunnelProvider({ ...baseOpts, fetchImpl, openTunnel });
    await p.isAvailable(new AbortController().signal);
    await p.isAvailable(new AbortController().signal);
    expect(openTunnel).toHaveBeenCalledTimes(1);
  });

  it('generate uses cached tunnel localUrl', async () => {
    const { handle } = makeFakeTunnel('http://1.2.3.4:5555');
    const openTunnel = vi.fn(async () => handle);
    const { fetchImpl, captured } = makeCapturingFetch((url) => {
      if (url.includes('/api/tags')) return okResponse({ models: [] });
      if (url.includes('/api/generate')) return okResponse({ response: 'add-error-handling-to-api' });
      return errorResponse(404);
    });
    const p = new OllamaSshTunnelProvider({ ...baseOpts, fetchImpl, openTunnel });
    // First call opens tunnel + probes
    expect(await p.isAvailable(new AbortController().signal)).toBe(true);
    // Then generate uses cached tunnel
    const out = await p.generate('refactor auth middleware', new AbortController().signal);
    expect(out).toBe('add-error-handling-to-api');
    const generateCall = captured.find((c) => c.url.includes('/api/generate'))!;
    expect(generateCall.url).toBe('http://1.2.3.4:5555/api/generate');
  });

  it('generate returns null when tunnel cannot be opened', async () => {
    const openTunnel = vi.fn(async () => { throw new Error('ssh connection refused'); });
    const { fetchImpl } = makeCapturingFetch(() => okResponse({ models: [] }));
    const p = new OllamaSshTunnelProvider({ ...baseOpts, fetchImpl, openTunnel });
    expect(await p.generate('hi', new AbortController().signal)).toBeNull();
  });

  it('generate returns null when /api/generate returns non-2xx', async () => {
    const { handle } = makeFakeTunnel();
    const openTunnel = vi.fn(async () => handle);
    const { fetchImpl } = makeCapturingFetch((url) => {
      if (url.includes('/api/tags')) return okResponse({ models: [] });
      if (url.includes('/api/generate')) return errorResponse(500);
      return errorResponse(404);
    });
    const p = new OllamaSshTunnelProvider({ ...baseOpts, fetchImpl, openTunnel });
    expect(await p.generate('hi', new AbortController().signal)).toBeNull();
  });

  it('dispose closes the tunnel only once even if called twice', async () => {
    const { handle, closed } = makeFakeTunnel();
    const openTunnel = vi.fn(async () => handle);
    const p = new OllamaSshTunnelProvider({
      ...baseOpts,
      fetchImpl: vi.fn() as unknown as typeof fetch,
      openTunnel,
    });
    await p.isAvailable(new AbortController().signal);
    await p.dispose?.();
    await p.dispose?.();
    expect(closed.value).toBe(true);
  });

  it('dispose is a no-op when tunnel was never opened', async () => {
    const p = new OllamaSshTunnelProvider({
      ...baseOpts,
      fetchImpl: vi.fn() as unknown as typeof fetch,
      openTunnel: vi.fn(),
    });
    await expect(p.dispose?.()).resolves.toBeUndefined();
  });

  it('isAvailable after dispose reopens tunnel', async () => {
    const { handle } = makeFakeTunnel();
    const openTunnel = vi.fn(async () => handle);
    const { fetchImpl } = makeCapturingFetch((url) =>
      url.includes('/api/tags') ? okResponse({ models: [] }) : errorResponse(404),
    );
    const p = new OllamaSshTunnelProvider({ ...baseOpts, fetchImpl, openTunnel });
    await p.isAvailable(new AbortController().signal);
    await p.dispose?.();
    await p.isAvailable(new AbortController().signal);
    expect(openTunnel).toHaveBeenCalledTimes(2);
  });
});