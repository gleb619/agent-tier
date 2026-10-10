import { describe, it, expect, vi } from 'vitest';
import { linkAbort, fetchWithTimeout } from '../../../src/namer/providers/shared';

describe('linkAbort', () => {
  it('aborts the controller immediately when the signal is already aborted', () => {
    const caller = new AbortController();
    caller.abort();
    const inner = new AbortController();

    const off = linkAbort(caller.signal, inner);

    expect(inner.signal.aborted).toBe(true);
    expect(typeof off).toBe('function');
    expect(() => off()).not.toThrow();
  });

  it('forwards a later abort to the controller', () => {
    const caller = new AbortController();
    const inner = new AbortController();

    linkAbort(caller.signal, inner);
    expect(inner.signal.aborted).toBe(false);

    caller.abort();
    expect(inner.signal.aborted).toBe(true);
  });

  it('off() unsubscribes so later aborts are not forwarded', () => {
    const caller = new AbortController();
    const inner = new AbortController();

    const off = linkAbort(caller.signal, inner);
    off();
    caller.abort();

    expect(caller.signal.aborted).toBe(true);
    expect(inner.signal.aborted).toBe(false);
  });

  it('off() is idempotent', () => {
    const caller = new AbortController();
    const inner = new AbortController();

    const off = linkAbort(caller.signal, inner);
    expect(() => { off(); off(); }).not.toThrow();
    caller.abort();
    expect(inner.signal.aborted).toBe(false);
  });

  it('tolerates a missing signal', () => {
    const inner = new AbortController();
    const off = linkAbort(undefined as unknown as AbortSignal, inner);
    expect(inner.signal.aborted).toBe(false);
    expect(() => off()).not.toThrow();
  });
});

describe('fetchWithTimeout', () => {
  const okResponse = { ok: true, status: 200 } as unknown as Response;

  it('passes url and init through, replacing signal with its own controller', async () => {
    const fetchImpl = vi.fn(async () => okResponse);
    const init: RequestInit = {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"a":1}',
    };

    const res = await fetchWithTimeout('http://x/api/generate', init, {
      timeoutMs: 1000,
      signal: new AbortController().signal,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(res).toBe(okResponse);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, sentInit] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://x/api/generate');
    expect(sentInit.method).toBe('POST');
    expect(sentInit.headers).toEqual({ 'content-type': 'application/json' });
    expect(sentInit.body).toBe('{"a":1}');
    expect(sentInit.signal).toBeInstanceOf(AbortSignal);
  });

  it('overrides a caller-supplied init.signal with the internal one', async () => {
    const fetchImpl = vi.fn(async () => okResponse);
    const caller = new AbortController();

    await fetchWithTimeout('http://x', { signal: caller.signal }, {
      timeoutMs: 1000,
      signal: caller.signal,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const sentInit = (fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(sentInit.signal).not.toBe(caller.signal);
  });

  it('rejects when the timeout fires', async () => {
    const fetchImpl = vi.fn((_url: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted by timeout')));
      }),
    );

    await expect(
      fetchWithTimeout('http://x', {}, {
        timeoutMs: 20,
        signal: new AbortController().signal,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toThrow('aborted by timeout');
  });

  it('aborts the in-flight request when the caller signal aborts', async () => {
    const caller = new AbortController();
    let seen: AbortSignal | undefined;
    const fetchImpl = vi.fn((_url: string | URL | Request, init?: RequestInit) => {
      seen = init?.signal ?? undefined;
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted by caller')));
      });
    });

    const pending = fetchWithTimeout('http://x', {}, {
      timeoutMs: 60_000,
      signal: caller.signal,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    caller.abort();

    await expect(pending).rejects.toThrow('aborted by caller');
    expect(seen?.aborted).toBe(true);
  });

  it('does not abort an already-aborted caller signal request later (short-circuit)', async () => {
    const caller = new AbortController();
    caller.abort();
    const fetchImpl = vi.fn((_url: string | URL | Request, init?: RequestInit) => {
      expect(init?.signal?.aborted).toBe(true);
      return Promise.reject(new Error('aborted before send'));
    });

    await expect(
      fetchWithTimeout('http://x', {}, {
        timeoutMs: 1000,
        signal: caller.signal,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toThrow('aborted before send');
  });

  it('propagates fetch errors to the caller', async () => {
    const fetchImpl = vi.fn(async () => { throw new Error('ECONNREFUSED'); });

    await expect(
      fetchWithTimeout('http://x', {}, {
        timeoutMs: 1000,
        signal: new AbortController().signal,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toThrow('ECONNREFUSED');
  });

  it('clears the timeout after a successful response (no late abort)', async () => {
    let seen: AbortSignal | undefined;
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      seen = init?.signal ?? undefined;
      return okResponse;
    });

    await fetchWithTimeout('http://x', {}, {
      timeoutMs: 20,
      signal: new AbortController().signal,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await new Promise((r) => setTimeout(r, 60));

    expect(seen?.aborted).toBe(false);
  });

  it('unlinks the caller signal after the request settles', async () => {
    const caller = new AbortController();
    let seen: AbortSignal | undefined;
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      seen = init?.signal ?? undefined;
      return okResponse;
    });

    await fetchWithTimeout('http://x', {}, {
      timeoutMs: 1000,
      signal: caller.signal,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    caller.abort();

    expect(seen?.aborted).toBe(false);
  });
});
