import {
  generateSessionName,
  sanitizeName,
  NAMER_MIN_LEN,
  NAMER_MAX_LEN,
  DEFAULT_NAMER_MODEL,
  DEFAULT_NAMER_URL,
} from '../src/ollama-namer';
import { describe, it, expect, vi } from 'vitest';

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

interface CapturedCall {
  url: string;
  init: RequestInit;
}

function makeCapturingFetch(responder: () => Response): { fetchImpl: typeof fetch; captured: CapturedCall[] } {
  const captured: CapturedCall[] = [];
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    captured.push({ url: String(url), init: init ?? {} });
    return responder();
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

describe('generateSessionName', () => {
  it('returns null for empty prompt', async () => {
    const fetchImpl = vi.fn();
    const out = await generateSessionName('', { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(out).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('returns null when fetch is missing', async () => {
    const out = await generateSessionName('hello world', { fetchImpl: undefined as unknown as typeof fetch });
    expect(out).toBeNull();
  });

  it('returns sanitized name on success', async () => {
    const { fetchImpl, captured } = makeCapturingFetch(() =>
      okResponse({ response: 'add-error-handling-to-api' }),
    );
    const out = await generateSessionName('please add error handling', { fetchImpl });
    expect(out).toBe('add-error-handling-to-api');
    expect(captured).toHaveLength(1);
  });

  it('sends correct request body to ollama /api/generate', async () => {
    const { fetchImpl, captured } = makeCapturingFetch(() =>
      okResponse({ response: 'kebab-case-session-name-please-okay' }),
    );
    await generateSessionName('do a thing', { fetchImpl, model: 'gemma:2b', url: 'http://example.com' });

    expect(captured).toHaveLength(1);
    const call = captured[0]!;
    expect(call.url).toBe('http://example.com/api/generate');
    const body = JSON.parse(call.init.body as string);
    expect(body.model).toBe('gemma:2b');
    expect(body.stream).toBe(false);
    expect(body.prompt).toContain('Prompt:');
    expect(body.prompt).toContain('do a thing');
    expect(call.init.signal).toBeDefined();
    expect((call.init.headers as Record<string, string>)['content-type']).toBe('application/json');
  });

  it('returns null on non-2xx response', async () => {
    const { fetchImpl } = makeCapturingFetch(() => errorResponse(500));
    const out = await generateSessionName('hello', { fetchImpl });
    expect(out).toBeNull();
  });

  it('returns null when ollama returns error field', async () => {
    const { fetchImpl } = makeCapturingFetch(() => okResponse({ error: 'model not found' }));
    const out = await generateSessionName('hello', { fetchImpl });
    expect(out).toBeNull();
  });

  it('returns null when response field is missing', async () => {
    const { fetchImpl } = makeCapturingFetch(() => okResponse({ model: 'gemma:2b' }));
    const out = await generateSessionName('hello', { fetchImpl });
    expect(out).toBeNull();
  });

  it('returns null when fetch throws', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    });
    const out = await generateSessionName('hello', { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(out).toBeNull();
  });

  it('returns null when JSON body is malformed', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError('not json');
      },
    }));
    const out = await generateSessionName('hello', { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(out).toBeNull();
  });

  it('uses defaults from env when not provided', async () => {
    const previousUrl = process.env.AT_NAMER_URL;
    const previousModel = process.env.AT_NAMER_MODEL;
    process.env.AT_NAMER_URL = 'http://from-env:11434';
    process.env.AT_NAMER_MODEL = 'gemma:from-env';

    try {
      const { fetchImpl, captured } = makeCapturingFetch(() =>
        okResponse({ response: 'kebab-case-session-name-please-okay' }),
      );
      await generateSessionName('hi', { fetchImpl });
      expect(captured[0]!.url).toBe('http://from-env:11434/api/generate');
      expect(JSON.parse(captured[0]!.init.body as string).model).toBe('gemma:from-env');
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
        okResponse({ response: 'kebab-case-session-name-please-okay' }),
      );
      await generateSessionName('hi', { fetchImpl });
      expect(captured[0]!.url).toBe(`${DEFAULT_NAMER_URL}/api/generate`);
      expect(JSON.parse(captured[0]!.init.body as string).model).toBe(DEFAULT_NAMER_MODEL);
    } finally {
      if (previousUrl === undefined) delete process.env.AT_NAMER_URL;
      else process.env.AT_NAMER_URL = previousUrl;
      if (previousModel === undefined) delete process.env.AT_NAMER_MODEL;
      else process.env.AT_NAMER_MODEL = previousModel;
    }
  });
});
