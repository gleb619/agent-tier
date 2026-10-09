import {
  generateSessionName,
  sanitizeName,
  NAMER_MIN_LEN,
  NAMER_MAX_LEN,
  DEFAULT_NAMER_MODEL,
  DEFAULT_NAMER_URL,
} from '../src/ollama-namer';

describe('sanitizeName', () => {
  it('keeps well-formed kebab-case names unchanged', () => {
    const input = 'add-error-handling-to-api';
    expect(sanitizeName(input)).toBe(input);
  });

  it('lowercases uppercase letters', () => {
    expect(sanitizeName('Add-Error-Handling')).toBe('add-error-handling');
  });

  it('collapses non-kebab characters to hyphens', () => {
    expect(sanitizeName('fix the bug! now')).toBe('fix-the-bug-now');
  });

  it('collapses consecutive hyphens', () => {
    expect(sanitizeName('foo---bar')).toBe('foo-bar');
  });

  it('trims leading and trailing hyphens', () => {
    expect(sanitizeName('--hello--')).toBe('hello');
  });

  it('strips code-fence wrappers', () => {
    expect(sanitizeName('```refactor-auth-module```')).toBe('refactor-auth-module');
  });

  it('strips quote wrappers', () => {
    expect(sanitizeName('"hello-world"')).toBe('hello-world');
  });

  it('strips backtick wrappers', () => {
    expect(sanitizeName('`hello-world`')).toBe('hello-world');
  });

  it('pads too-short output to NAMER_MIN_LEN', () => {
    const out = sanitizeName('short');
    expect(out).not.toBeNull();
    expect(out!.length).toBeGreaterThanOrEqual(NAMER_MIN_LEN);
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
    expect(out).not.toMatch(/-+$/);
  });
});

describe('generateSessionName', () => {
  function makeFetch(responder: (body: unknown) => { status: number; body: unknown } | null) {
    return jest.fn(async (_url: string, _init?: RequestInit) => {
      const r = responder(undefined);
      if (!r) {
        return { ok: false, status: 500, json: async () => ({ error: 'mock' }) } as Response;
      }
      return {
        ok: r.status >= 200 && r.status < 300,
        status: r.status,
        json: async () => r.body,
      } as Response;
    });
  }

  it('returns null for empty prompt', async () => {
    const fetchImpl = jest.fn();
    const out = await generateSessionName('', { fetchImpl });
    expect(out).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('returns null when fetch is missing', async () => {
    const out = await generateSessionName('hello world', { fetchImpl: undefined as unknown as typeof fetch });
    expect(out).toBeNull();
  });

  it('returns sanitized name on success', async () => {
    const fetchImpl = makeFetch(() => ({ status: 200, body: { response: 'add-error-handling-to-api' } }));
    const out = await generateSessionName('please add error handling', { fetchImpl });
    expect(out).toBe('add-error-handling-to-api');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('sends correct request body to ollama /api/generate', async () => {
    const fetchImpl = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ response: 'kebab-case-session-name-please-okay' }),
    })) as unknown as typeof fetch;

    await generateSessionName('do a thing', { fetchImpl, model: 'gemma:2b', url: 'http://example.com' });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = (fetchImpl as jest.Mock).mock.calls[0];
    expect(url).toBe('http://example.com/api/generate');
    const body = JSON.parse(init.body);
    expect(body.model).toBe('gemma:2b');
    expect(body.stream).toBe(false);
    expect(body.prompt).toContain('Prompt:');
    expect(body.prompt).toContain('do a thing');
    expect(init.signal).toBeDefined();
    expect(init.headers['content-type']).toBe('application/json');
  });

  it('returns null on non-2xx response', async () => {
    const fetchImpl = makeFetch(() => null); // forces 500 fallback
    const out = await generateSessionName('hello', { fetchImpl });
    expect(out).toBeNull();
  });

  it('returns null when ollama returns error field', async () => {
    const fetchImpl = makeFetch(() => ({ status: 200, body: { error: 'model not found' } }));
    const out = await generateSessionName('hello', { fetchImpl });
    expect(out).toBeNull();
  });

  it('returns null when response field is missing', async () => {
    const fetchImpl = makeFetch(() => ({ status: 200, body: { model: 'gemma:2b' } }));
    const out = await generateSessionName('hello', { fetchImpl });
    expect(out).toBeNull();
  });

  it('returns null when fetch throws', async () => {
    const fetchImpl = jest.fn(async () => {
      throw new Error('ECONNREFUSED');
    });
    const out = await generateSessionName('hello', { fetchImpl });
    expect(out).toBeNull();
  });

  it('returns null when JSON body is malformed', async () => {
    const fetchImpl = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError('not json');
      },
    })) as unknown as typeof fetch;
    const out = await generateSessionName('hello', { fetchImpl });
    expect(out).toBeNull();
  });

  it('uses defaults from env when not provided', async () => {
    const previousUrl = process.env.AT_NAMER_URL;
    const previousModel = process.env.AT_NAMER_MODEL;
    process.env.AT_NAMER_URL = 'http://from-env:11434';
    process.env.AT_NAMER_MODEL = 'gemma:from-env';

    try {
      const fetchImpl = jest.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ response: 'kebab-case-session-name-please-okay' }),
      })) as unknown as typeof fetch;

      await generateSessionName('hi', { fetchImpl });

      const [url, init] = (fetchImpl as jest.Mock).mock.calls[0];
      expect(url).toBe('http://from-env:11434/api/generate');
      expect(JSON.parse(init.body).model).toBe('gemma:from-env');
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
      const fetchImpl = jest.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ response: 'kebab-case-session-name-please-okay' }),
      })) as unknown as typeof fetch;

      await generateSessionName('hi', { fetchImpl });

      const [url, init] = (fetchImpl as jest.Mock).mock.calls[0];
      expect(url).toBe(`${DEFAULT_NAMER_URL}/api/generate`);
      expect(JSON.parse(init.body).model).toBe(DEFAULT_NAMER_MODEL);
    } finally {
      if (previousUrl === undefined) delete process.env.AT_NAMER_URL;
      else process.env.AT_NAMER_URL = previousUrl;
      if (previousModel === undefined) delete process.env.AT_NAMER_MODEL;
      else process.env.AT_NAMER_MODEL = previousModel;
    }
  });
});
