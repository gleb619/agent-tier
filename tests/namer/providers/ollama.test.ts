import { describe, it, expect, vi } from 'vitest';
import {
  OllamaProvider,
  sanitizeName,
  deriveName,
  NAMER_MIN_LEN,
  NAMER_SALVAGE_MIN_LEN,
  NAMER_MAX_LEN,
  NAMER_PROMPT_MAX_CHARS,
  DEFAULT_NAMER_MODEL,
  DEFAULT_NAMER_URL,
} from '../../../src/namer/providers/ollama';

// ---------- sanitizeName (ported from old src/ollama-namer.ts) ----------

describe('sanitizeName', () => {
  it('keeps well-formed kebab-case names unchanged', () => {
    const input = 'add-error-handling-to-api';
    expect(sanitizeName(input)).toBe(input);
  });

  it('lowercases uppercase letters', () => {
    expect(sanitizeName('Add-Error-Handling-To-Middleware')).toBe('add-error-handling-to-middleware');
  });

  it('collapses non-kebab characters to hyphens', () => {
    expect(sanitizeName('fix the bug right now please do')).toBe('fix-the-bug-right-now-please-do');
  });

  it('collapses consecutive hyphens', () => {
    expect(sanitizeName('foo---bar---baz---qux---end---tail')).toBe('foo-bar-baz-qux-end-tail');
  });

  it('trims leading and trailing hyphens', () => {
    expect(sanitizeName('--hello-world-okay-now--')).toBe('hello-world-okay-now');
  });

  it('strips code-fence wrappers', () => {
    expect(sanitizeName('```refactor-auth-module```')).toBe('refactor-auth-module');
  });

  it('strips quote wrappers', () => {
    expect(sanitizeName('"add-error-handling-now"')).toBe('add-error-handling-now');
  });

  it('strips backtick wrappers', () => {
    expect(sanitizeName('`add-error-handling-now`')).toBe('add-error-handling-now');
  });

  it('returns null when sanitized output is too short', () => {
    expect(sanitizeName('short')).toBeNull();
  });

  it('returns null for empty input', () => {
    expect(sanitizeName('')).toBeNull();
  });

  it('returns null when only invalid characters are present', () => {
    expect(sanitizeName('!!!')).toBeNull();
  });

  it('truncates too-long output to <= NAMER_MAX_LEN', () => {
    const long = 'a'.repeat(NAMER_MAX_LEN + 20);
    const out = sanitizeName(long);
    expect(out).not.toBeNull();
    expect(out!.length).toBeLessThanOrEqual(NAMER_MAX_LEN);
  });

  it('truncates on hyphens when result still meets NAMER_MIN_LEN', () => {
    const input = 'aaaa-bbbb-cccc-dddd-eeee-ffff-gggg-hhhh-iiii-jjjj-kkkk-llll-mmmm-nnnn-oooo-pppp';
    const out = sanitizeName(input)!;
    expect(out.length).toBeLessThanOrEqual(NAMER_MAX_LEN);
    expect(out.length).toBeGreaterThanOrEqual(NAMER_MIN_LEN);
    expect(out).not.toMatch(/-+$/);
  });
});

// ---------- deriveName (salvage of undersized model answers) ----------

describe('deriveName', () => {
  it('returns a compliant model answer verbatim', () => {
    expect(deriveName('add-error-handling-to-api', 'please add error handling')).toBe(
      'add-error-handling-to-api',
    );
  });

  it('still clamps an over-long model answer to NAMER_MAX_LEN', () => {
    const out = deriveName('a-'.repeat(100), 'some prompt');
    expect(out!.length).toBeLessThanOrEqual(NAMER_MAX_LEN);
  });

  // The actual bug: gemma3:1b answers "Auth-token-v2" (13 chars) for the auth
  // prompt. sanitizeName drops it -> every provider fails -> run stays unnamed.
  it('salvages a short model answer by padding with prompt keywords', () => {
    const out = deriveName('Auth-token-v2', 'refactor authentication service and validate user tokens');
    expect(out).not.toBeNull();
    expect(out!.length).toBeGreaterThanOrEqual(NAMER_MIN_LEN);
    expect(out!.length).toBeLessThanOrEqual(NAMER_MAX_LEN);
    expect(out!.startsWith('auth-token-v2')).toBe(true);
    expect(out).toMatch(/^[a-z0-9-]+$/);
  });

  it('keeps the model prefix when the answer is a space-separated phrase', () => {
    const out = deriveName('smoke test return', 'smoke test background return')!;
    expect(out.startsWith('smoke-test-return')).toBe(true);
    expect(out.length).toBeGreaterThanOrEqual(NAMER_MIN_LEN);
  });

  it('salvages an underscore name from the model', () => {
    const out = deriveName('test_hello', 'hello world test')!;
    expect(out.startsWith('test-hello')).toBe(true);
    expect(out).not.toBeNull();
  });

  it('does not repeat a keyword already present in the model answer', () => {
    const out = deriveName('test-name-1', 'simple test prompt to check naming')!;
    const parts = out.split('-');
    expect(new Set(parts).size).toBe(parts.length);
  });

  it('skips filler words when padding', () => {
    const out = deriveName('kanban', 'implement at kanban core in the agent-tier repo')!;
    expect(out).not.toMatch(/-the-|-and-|-for-/);
  });

  it('returns null when the raw answer has no usable characters', () => {
    expect(deriveName('', 'a perfectly good prompt')).toBeNull();
    expect(deriveName('   \n\t ', 'a perfectly good prompt')).toBeNull();
    expect(deriveName('!!!', 'a perfectly good prompt')).toBeNull();
  });

  it('never returns a name longer than NAMER_MAX_LEN after padding', () => {
    const out = deriveName('x', 'refactor authentication service and validate user tokens')!;
    expect(out.length).toBeLessThanOrEqual(NAMER_MAX_LEN);
  });

  it('keeps a salvaged name that cannot reach NAMER_MIN_LEN when the prompt runs dry', () => {
    const out = deriveName('test_hello', 'hello world test')!;
    expect(out.startsWith('test-hello')).toBe(true);
    expect(out.length).toBeGreaterThanOrEqual(NAMER_SALVAGE_MIN_LEN);
  });

  it('rejects noise too short to be a label even after padding', () => {
    expect(deriveName('x', 'hi ok')).toBeNull();
  });
});

// ---------- shared test plumbing ----------

interface CapturedCall {
  url: string;
  init: RequestInit;
}

function makeCapturingFetch(responder: (url: string) => Response): { fetchImpl: typeof fetch; captured: CapturedCall[] } {
  const captured: CapturedCall[] = [];
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    captured.push({ url: String(url), init: init ?? {} });
    return responder(String(url));
  });
  return { fetchImpl: fetchImpl as unknown as typeof fetch, captured };
}

function okResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  } as unknown as Response;
}

function errorResponse(status = 500): Response {
  return {
    ok: false,
    status,
    json: async () => ({ error: 'mock' }),
  } as unknown as Response;
}

const SUCCESS_BODY = 'kebab-case-session-name-please-okay';

function sentBody(captured: CapturedCall[]): Record<string, unknown> {
  return JSON.parse(captured[0]!.init.body as string) as Record<string, unknown>;
}

// ---------- OllamaProvider.generate (was the back-compat free function) ----------

describe('OllamaProvider.generate', () => {
  it('returns null for empty prompt', async () => {
    const fetchImpl = vi.fn();
    const p = new OllamaProvider({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const out = await p.generate('', new AbortController().signal);
    expect(out).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('returns null for whitespace-only prompt', async () => {
    const fetchImpl = vi.fn();
    const p = new OllamaProvider({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const out = await p.generate('   \n\t ', new AbortController().signal);
    expect(out).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('returns null when fetchImpl is not a function', async () => {
    const p = new OllamaProvider({ fetchImpl: {} as unknown as typeof fetch });
    expect(await p.generate('hello world', new AbortController().signal)).toBeNull();
  });

  it('returns sanitized name on success', async () => {
    const { fetchImpl, captured } = makeCapturingFetch(() =>
      okResponse({ response: 'add-error-handling-to-api' }),
    );
    const p = new OllamaProvider({ fetchImpl });
    const out = await p.generate('please add error handling', new AbortController().signal);
    expect(out).toBe('add-error-handling-to-api');
    expect(captured).toHaveLength(1);
  });

  it('sends correct request body to ollama /api/generate', async () => {
    const { fetchImpl, captured } = makeCapturingFetch(() =>
      okResponse({ response: SUCCESS_BODY }),
    );
    const p = new OllamaProvider({ fetchImpl, url: 'http://example.com', model: 'gemma:2b' });
    await p.generate('do a thing', new AbortController().signal);
    expect(captured).toHaveLength(1);
    const call = captured[0]!;
    expect(call.url).toBe('http://example.com/api/generate');
    expect(call.init.method).toBe('POST');
    const body = sentBody(captured);
    expect(body.model).toBe('gemma:2b');
    expect(body.stream).toBe(false);
    expect(body.prompt).toContain('Prompt:');
    expect(body.prompt).toContain('do a thing');
    expect(body.options).toEqual({ temperature: 0.2, num_predict: 64 });
    expect(call.init.signal).toBeDefined();
    expect((call.init.headers as Record<string, string>)['content-type']).toBe('application/json');
  });

  it('sends think:false at the top level so thinking models still emit a name', async () => {
    const { fetchImpl, captured } = makeCapturingFetch(() =>
      okResponse({ response: SUCCESS_BODY }),
    );
    const p = new OllamaProvider({ fetchImpl, url: 'http://x', model: 'gemma4' });
    await p.generate('simplify the namer', new AbortController().signal);
    const body = sentBody(captured);
    expect(body.think).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(body, 'think')).toBe(true);
    const options = body.options as Record<string, unknown>;
    expect(options.think).toBeUndefined();
  });

  it('truncates the prompt to NAMER_PROMPT_MAX_CHARS, keeping system prompt + Name suffix', async () => {
    const { fetchImpl, captured } = makeCapturingFetch(() =>
      okResponse({ response: SUCCESS_BODY }),
    );
    const long = Array.from({ length: NAMER_PROMPT_MAX_CHARS + 150 }, (_unused, i) => `w${i}`).join(' ');
    expect(long.length).toBeGreaterThan(NAMER_PROMPT_MAX_CHARS);

    const p = new OllamaProvider({ fetchImpl, url: 'http://x', model: 'm' });
    await p.generate(long, new AbortController().signal);

    const prompt = sentBody(captured).prompt as string;
    expect(prompt.startsWith('You generate short, kebab-case session names')).toBe(true);
    expect(prompt.endsWith('\n\nName:')).toBe(true);

    const marker = '\n\nPrompt:\n';
    const start = prompt.indexOf(marker);
    expect(start).toBeGreaterThan(0);
    const embedded = prompt.slice(start + marker.length, prompt.length - '\n\nName:'.length);
    expect(embedded).toBe(long.slice(0, NAMER_PROMPT_MAX_CHARS));
    expect(embedded).toHaveLength(NAMER_PROMPT_MAX_CHARS);
  });

  it('leaves a short prompt untouched', async () => {
    const { fetchImpl, captured } = makeCapturingFetch(() =>
      okResponse({ response: SUCCESS_BODY }),
    );
    const p = new OllamaProvider({ fetchImpl, url: 'http://x', model: 'm' });
    await p.generate('do a thing', new AbortController().signal);
    const prompt = sentBody(captured).prompt as string;
    expect(prompt).toContain('\n\nPrompt:\ndo a thing\n\nName:');
  });

  it('returns null on non-2xx response', async () => {
    const { fetchImpl } = makeCapturingFetch(() => errorResponse(500));
    const p = new OllamaProvider({ fetchImpl });
    expect(await p.generate('hello', new AbortController().signal)).toBeNull();
  });

  it('returns null when ollama returns error field', async () => {
    const { fetchImpl } = makeCapturingFetch(() => okResponse({ error: 'model not found' }));
    const p = new OllamaProvider({ fetchImpl });
    expect(await p.generate('hello', new AbortController().signal)).toBeNull();
  });

  it('returns null when response field is missing', async () => {
    const { fetchImpl } = makeCapturingFetch(() => okResponse({ model: 'gemma:2b' }));
    const p = new OllamaProvider({ fetchImpl });
    expect(await p.generate('hello', new AbortController().signal)).toBeNull();
  });

  it('returns null when response is an empty string (num_predict eaten by reasoning)', async () => {
    const { fetchImpl } = makeCapturingFetch(() => okResponse({ response: '' }));
    const p = new OllamaProvider({ fetchImpl, url: 'http://x', model: 'gemma4' });
    expect(await p.generate('simplify the namer', new AbortController().signal)).toBeNull();
  });

  // Regression: gemma3:1b ignores the 20-char instruction and answers
  // "Auth-token-v2". sanitizeName rejected it, so generate() returned null,
  // every provider failed, and the run was persisted as `unnamed` forever.
  it('salvages an undersized model answer instead of returning null', async () => {
    const { fetchImpl } = makeCapturingFetch(() => okResponse({ response: 'Auth-token-v2\n' }));
    const p = new OllamaProvider({ fetchImpl });
    const out = await p.generate(
      'refactor authentication service and validate user tokens',
      new AbortController().signal,
    );
    expect(out).not.toBeNull();
    expect(out!.length).toBeGreaterThanOrEqual(NAMER_MIN_LEN);
    expect(out!.startsWith('auth-token-v2')).toBe(true);
  });

  it('still returns null when the model answer has no usable characters', async () => {
    const { fetchImpl } = makeCapturingFetch(() => okResponse({ response: '!!!' }));
    const p = new OllamaProvider({ fetchImpl });
    expect(await p.generate('a real prompt here', new AbortController().signal)).toBeNull();
  });

  it('returns null when fetch throws', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    });
    const p = new OllamaProvider({ fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(await p.generate('hello', new AbortController().signal)).toBeNull();
  });

  it('returns null when JSON body is malformed', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError('not json');
      },
    }));
    const p = new OllamaProvider({ fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(await p.generate('hello', new AbortController().signal)).toBeNull();
  });

  it('uses url and model from env when not provided', async () => {
    const previousUrl = process.env.AT_NAMER_URL;
    const previousModel = process.env.AT_NAMER_MODEL;
    process.env.AT_NAMER_URL = 'http://from-env:11434';
    process.env.AT_NAMER_MODEL = 'gemma:from-env';

    try {
      const { fetchImpl, captured } = makeCapturingFetch(() =>
        okResponse({ response: SUCCESS_BODY }),
      );
      const p = new OllamaProvider({ fetchImpl });
      await p.generate('hi', new AbortController().signal);
      expect(captured[0]!.url).toBe('http://from-env:11434/api/generate');
      expect(sentBody(captured).model).toBe('gemma:from-env');
    } finally {
      if (previousUrl === undefined) delete process.env.AT_NAMER_URL;
      else process.env.AT_NAMER_URL = previousUrl;
      if (previousModel === undefined) delete process.env.AT_NAMER_MODEL;
      else process.env.AT_NAMER_MODEL = previousModel;
    }
  });

  it('falls back to default url and model when no env', async () => {
    const previousUrl = process.env.AT_NAMER_URL;
    const previousModel = process.env.AT_NAMER_MODEL;
    delete process.env.AT_NAMER_URL;
    delete process.env.AT_NAMER_MODEL;

    try {
      const { fetchImpl, captured } = makeCapturingFetch(() =>
        okResponse({ response: SUCCESS_BODY }),
      );
      const p = new OllamaProvider({ fetchImpl });
      await p.generate('hi', new AbortController().signal);
      expect(captured[0]!.url).toBe(`${DEFAULT_NAMER_URL}/api/generate`);
      expect(sentBody(captured).model).toBe(DEFAULT_NAMER_MODEL);
    } finally {
      if (previousUrl === undefined) delete process.env.AT_NAMER_URL;
      else process.env.AT_NAMER_URL = previousUrl;
      if (previousModel === undefined) delete process.env.AT_NAMER_MODEL;
      else process.env.AT_NAMER_MODEL = previousModel;
    }
  });

  it('honours AT_NAMER_TIMEOUT_MS for the abort timer', async () => {
    const previous = process.env.AT_NAMER_TIMEOUT_MS;
    process.env.AT_NAMER_TIMEOUT_MS = '50';
    try {
      let seenSignal: AbortSignal | undefined;
      const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
        seenSignal = init?.signal ?? undefined;
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        });
      });
      const p = new OllamaProvider({ url: 'http://x', model: 'm', fetchImpl: fetchImpl as unknown as typeof fetch });
      expect(await p.generate('hi', new AbortController().signal)).toBeNull();
      expect(seenSignal?.aborted).toBe(true);
    } finally {
      if (previous === undefined) delete process.env.AT_NAMER_TIMEOUT_MS;
      else process.env.AT_NAMER_TIMEOUT_MS = previous;
    }
  });

  it('aborts the in-flight request when the caller signal aborts', async () => {
    const controller = new AbortController();
    let seenSignal: AbortSignal | undefined;
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      seenSignal = init?.signal ?? undefined;
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      });
    });
    const p = new OllamaProvider({ url: 'http://x', model: 'm', fetchImpl: fetchImpl as unknown as typeof fetch });
    const pending = p.generate('hi', controller.signal);
    await Promise.resolve();
    controller.abort();
    expect(await pending).toBeNull();
    expect(seenSignal?.aborted).toBe(true);
  });
});

// ---------- OllamaProvider class (NamerProvider implementation) ----------

describe('OllamaProvider', () => {
  it('exposes a stable name', () => {
    const p = new OllamaProvider({ name: 'local-ollama', fetchImpl: vi.fn() as unknown as typeof fetch });
    expect(p.name).toBe('local-ollama');
  });

  it('generate returns sanitized name on /api/generate success', async () => {
    const { fetchImpl } = makeCapturingFetch((url) => {
      if (url.endsWith('/api/generate')) return okResponse({ response: 'add-error-handling-to-api' });
      return errorResponse(404);
    });
    const p = new OllamaProvider({ url: 'http://x', model: 'm', fetchImpl });
    const out = await p.generate('do a thing', new AbortController().signal);
    expect(out).toBe('add-error-handling-to-api');
  });

  it('generate returns null on non-2xx', async () => {
    const { fetchImpl } = makeCapturingFetch(() => errorResponse(500));
    const p = new OllamaProvider({ url: 'http://x', model: 'm', fetchImpl });
    expect(await p.generate('hi', new AbortController().signal)).toBeNull();
  });

  it('generate returns null on fetch throw', async () => {
    const fetchImpl = vi.fn(async () => { throw new Error('ECONNREFUSED'); });
    const p = new OllamaProvider({ url: 'http://x', model: 'm', fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(await p.generate('hi', new AbortController().signal)).toBeNull();
  });

  it('isAvailable returns true when GET /api/tags is 2xx', async () => {
    const { fetchImpl, captured } = makeCapturingFetch((url) => {
      if (url.endsWith('/api/tags')) return okResponse({ models: [] });
      return errorResponse(404);
    });
    const p = new OllamaProvider({ url: 'http://x', model: 'm', fetchImpl });
    expect(await p.isAvailable(new AbortController().signal)).toBe(true);
    expect(captured[0]!.url).toBe('http://x/api/tags');
    expect(captured[0]!.init.method).toBe('GET');
  });

  it('isAvailable returns false on non-2xx', async () => {
    const { fetchImpl } = makeCapturingFetch(() => errorResponse(503));
    const p = new OllamaProvider({ url: 'http://x', model: 'm', fetchImpl });
    expect(await p.isAvailable(new AbortController().signal)).toBe(false);
  });

  it('isAvailable returns false on fetch throw', async () => {
    const fetchImpl = vi.fn(async () => { throw new Error('ECONNREFUSED'); });
    const p = new OllamaProvider({ url: 'http://x', model: 'm', fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(await p.isAvailable(new AbortController().signal)).toBe(false);
  });

  it('isAvailable returns false when fetchImpl is not a function', async () => {
    const p = new OllamaProvider({ url: 'http://x', model: 'm', fetchImpl: {} as unknown as typeof fetch });
    expect(await p.isAvailable(new AbortController().signal)).toBe(false);
  });

  it('holds no resources to dispose', () => {
    const p = new OllamaProvider({ fetchImpl: vi.fn() as unknown as typeof fetch });
    expect((p as unknown as { dispose?: unknown }).dispose).toBeUndefined();
  });
});
