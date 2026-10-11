import { describe, expect, it, vi } from "vitest";
import { OpenRouterProvider } from "../../../src/namer/providers/openrouter";

interface CapturedCall {
  url: string;
  init: RequestInit;
}

function makeCapturingFetch(responder: (url: string, init?: RequestInit) => Response): {
  fetchImpl: typeof fetch;
  captured: CapturedCall[];
} {
  const captured: CapturedCall[] = [];
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    captured.push({ url: String(url), init: init ?? {} });
    return responder(String(url), init);
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

function errorResponse(status = 500, body: unknown = { error: "mock" }): Response {
  return {
    ok: false,
    status,
    json: async () => body,
  } as unknown as Response;
}

const SUCCESS_CHOICES = {
  choices: [{ message: { role: "assistant", content: "add-error-handling-to-api" } }],
};

describe("OpenRouterProvider", () => {
  it("exposes a stable name", () => {
    const p = new OpenRouterProvider({
      name: "openrouter",
      url: "https://openrouter.ai/api/v1/chat/completions",
      model: "google/gemini-2.0-flash-exp:free",
      apiKey: "sk-or-v1-abc",
      fetchImpl: vi.fn() as unknown as typeof fetch,
    });
    expect(p.name).toBe("openrouter");
  });

  it("isAvailable true when apiKey is set", async () => {
    const p = new OpenRouterProvider({
      name: "openrouter",
      url: "https://x",
      model: "m",
      apiKey: "sk-or-v1-abc",
      fetchImpl: vi.fn() as unknown as typeof fetch,
    });
    expect(await p.isAvailable(new AbortController().signal)).toBe(true);
  });

  it("isAvailable false when apiKey is undefined", async () => {
    const p = new OpenRouterProvider({
      name: "openrouter",
      url: "https://x",
      model: "m",
      apiKey: undefined,
      fetchImpl: vi.fn() as unknown as typeof fetch,
    });
    expect(await p.isAvailable(new AbortController().signal)).toBe(false);
  });

  it("isAvailable false when apiKey is empty string", async () => {
    const p = new OpenRouterProvider({
      name: "openrouter",
      url: "https://x",
      model: "m",
      apiKey: "",
      fetchImpl: vi.fn() as unknown as typeof fetch,
    });
    expect(await p.isAvailable(new AbortController().signal)).toBe(false);
  });

  it("generate sends Authorization Bearer header + correct body", async () => {
    const { fetchImpl, captured } = makeCapturingFetch(() => okResponse(SUCCESS_CHOICES));
    const p = new OpenRouterProvider({
      name: "openrouter",
      url: "https://openrouter.ai/api/v1/chat/completions",
      model: "google/gemini-2.0-flash-exp:free",
      apiKey: "sk-or-v1-abc",
      fetchImpl,
    });
    await p.generate("refactor auth middleware", new AbortController().signal);
    expect(captured).toHaveLength(1);
    const call = captured[0]!;
    expect(call.url).toBe("https://openrouter.ai/api/v1/chat/completions");
    const headers = call.init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer sk-or-v1-abc");
    expect(headers["content-type"]).toBe("application/json");
    const body = JSON.parse(call.init.body as string);
    expect(body.model).toBe("google/gemini-2.0-flash-exp:free");
    expect(body.messages).toEqual([{ role: "user", content: "refactor auth middleware" }]);
    expect(body.stream).toBe(false);
    expect(call.init.signal).toBeDefined();
  });

  it("generate returns sanitized name on success", async () => {
    const { fetchImpl } = makeCapturingFetch(() => okResponse(SUCCESS_CHOICES));
    const p = new OpenRouterProvider({
      name: "openrouter",
      url: "https://x",
      model: "m",
      apiKey: "k",
      fetchImpl,
    });
    expect(await p.generate("whatever", new AbortController().signal)).toBe("add-error-handling-to-api");
  });

  it("generate returns null on non-2xx", async () => {
    const { fetchImpl } = makeCapturingFetch(() => errorResponse(500));
    const p = new OpenRouterProvider({
      name: "openrouter",
      url: "https://x",
      model: "m",
      apiKey: "k",
      fetchImpl,
    });
    expect(await p.generate("hi", new AbortController().signal)).toBeNull();
  });

  it("generate returns null on 401 (bad key)", async () => {
    const { fetchImpl } = makeCapturingFetch(() => errorResponse(401));
    const p = new OpenRouterProvider({
      name: "openrouter",
      url: "https://x",
      model: "m",
      apiKey: "bad-key",
      fetchImpl,
    });
    expect(await p.generate("hi", new AbortController().signal)).toBeNull();
  });

  it("generate returns null when choices is missing", async () => {
    const { fetchImpl } = makeCapturingFetch(() => okResponse({}));
    const p = new OpenRouterProvider({
      name: "openrouter",
      url: "https://x",
      model: "m",
      apiKey: "k",
      fetchImpl,
    });
    expect(await p.generate("hi", new AbortController().signal)).toBeNull();
  });

  it("generate returns null when message content is missing", async () => {
    const { fetchImpl } = makeCapturingFetch(() => okResponse({ choices: [{ message: {} }] }));
    const p = new OpenRouterProvider({
      name: "openrouter",
      url: "https://x",
      model: "m",
      apiKey: "k",
      fetchImpl,
    });
    expect(await p.generate("hi", new AbortController().signal)).toBeNull();
  });

  it("generate returns null when fetch throws", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    });
    const p = new OpenRouterProvider({
      name: "openrouter",
      url: "https://x",
      model: "m",
      apiKey: "k",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(await p.generate("hi", new AbortController().signal)).toBeNull();
  });

  it("generate returns null when apiKey missing (caller bug)", async () => {
    const { fetchImpl } = makeCapturingFetch(() => okResponse(SUCCESS_CHOICES));
    const p = new OpenRouterProvider({
      name: "openrouter",
      url: "https://x",
      model: "m",
      apiKey: undefined,
      fetchImpl,
    });
    expect(await p.generate("hi", new AbortController().signal)).toBeNull();
  });

  it("generate returns null on unsanitizable output", async () => {
    const { fetchImpl } = makeCapturingFetch(() =>
      okResponse({
        choices: [{ message: { role: "assistant", content: "!!!" } }],
      }),
    );
    const p = new OpenRouterProvider({
      name: "openrouter",
      url: "https://x",
      model: "m",
      apiKey: "k",
      fetchImpl,
    });
    expect(await p.generate("hi", new AbortController().signal)).toBeNull();
  });

  it("generate salvages an undersized answer using the prompt", async () => {
    const { fetchImpl } = makeCapturingFetch(() =>
      okResponse({
        choices: [{ message: { role: "assistant", content: "Auth-token-v2" } }],
      }),
    );
    const p = new OpenRouterProvider({
      name: "openrouter",
      url: "https://x",
      model: "m",
      apiKey: "k",
      fetchImpl,
    });
    const out = await p.generate(
      "refactor authentication service and validate user tokens",
      new AbortController().signal,
    );
    expect(out).not.toBeNull();
    expect(out!.startsWith("auth-token-v2")).toBe(true);
    expect(out!.length).toBeGreaterThanOrEqual(20);
  });

  it("holds no resources to dispose", () => {
    const p = new OpenRouterProvider({
      name: "openrouter",
      url: "https://x",
      model: "m",
      apiKey: "k",
      fetchImpl: vi.fn() as unknown as typeof fetch,
    });
    expect((p as unknown as { dispose?: unknown }).dispose).toBeUndefined();
  });
});
