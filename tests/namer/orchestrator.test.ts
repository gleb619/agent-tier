import { beforeEach, describe, expect, it, vi } from "vitest";
import { NAMER_PROMPT_MAX_CHARS } from "../../src/namer";
import { generateSessionName } from "../../src/namer/orchestrator";
import type { NamerConfig, NamerProvider } from "../../src/namer/types";

const TEST_PROMPT = "refactor auth middleware to support OIDC";

function makeProvider(overrides: Partial<NamerProvider>): NamerProvider {
  return {
    name: "mock",
    async isAvailable() {
      return true;
    },
    async generate() {
      return null;
    },
    ...overrides,
  };
}

const defaultCfg: NamerConfig = { providers: [] };

describe("generateSessionName", () => {
  beforeEach(() => {
    delete process.env.AT_NAMER_CONFIG;
  });

  it("returns the fallback when no providers are configured", async () => {
    const result = await generateSessionName(TEST_PROMPT, "/tmp/at-state", {
      providers: defaultCfg.providers,
    });
    expect(result.name).toBe("unnamed");
    expect(result.provider).toBeNull();
  });

  it("returns the first provider that succeeds", async () => {
    const providers = [
      makeProvider({
        name: "a",
        async generate() {
          return null;
        },
      }),
      makeProvider({
        name: "b",
        async generate() {
          return "add-error-handling-to-api";
        },
      }),
      makeProvider({
        name: "c",
        async generate() {
          return "refactor-auth-middleware";
        },
      }),
    ];
    const result = await generateSessionName(TEST_PROMPT, "/tmp/at-state", { providers });
    expect(result.name).toBe("add-error-handling-to-api");
    expect(result.provider).toBe("b");
  });

  it("skips providers whose isAvailable is false", async () => {
    const providers = [
      makeProvider({
        name: "a",
        async isAvailable() {
          return false;
        },
        async generate() {
          return "a-name-should-not-be-used";
        },
      }),
      makeProvider({
        name: "b",
        async generate() {
          return "add-error-handling-to-api";
        },
      }),
    ];
    const result = await generateSessionName(TEST_PROMPT, "/tmp/at-state", { providers });
    expect(result.provider).toBe("b");
    expect(result.name).toBe("add-error-handling-to-api");
  });

  it("skips providers whose generate returns null", async () => {
    const providers = [
      makeProvider({
        name: "a",
        async generate() {
          return null;
        },
      }),
      makeProvider({
        name: "b",
        async generate() {
          return "add-error-handling-to-api";
        },
      }),
    ];
    const result = await generateSessionName(TEST_PROMPT, "/tmp/at-state", { providers });
    expect(result.provider).toBe("b");
  });

  it("returns fallbackName when all providers fail", async () => {
    const providers = [
      makeProvider({
        name: "a",
        async generate() {
          return null;
        },
      }),
      makeProvider({
        name: "b",
        async generate() {
          return null;
        },
      }),
    ];
    const result = await generateSessionName(TEST_PROMPT, "/tmp/at-state", {
      providers,
      fallbackName: "no-name-available",
    });
    expect(result.name).toBe("no-name-available");
    expect(result.provider).toBeNull();
  });

  it("catches and logs provider errors (does not throw)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const providers = [
      makeProvider({
        name: "bad",
        async isAvailable() {
          throw new Error("boom");
        },
        async generate() {
          return null;
        },
      }),
      makeProvider({
        name: "good",
        async generate() {
          return "add-error-handling-to-api";
        },
      }),
    ];
    const result = await generateSessionName(TEST_PROMPT, "/tmp/at-state", { providers });
    expect(result.provider).toBe("good");
    expect(result.name).toBe("add-error-handling-to-api");
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("passes prompt verbatim to provider.generate", async () => {
    let captured = "";
    const providers = [
      makeProvider({
        name: "spy",
        async generate(prompt: string) {
          captured = prompt;
          return "add-error-handling-to-api";
        },
      }),
    ];
    await generateSessionName(TEST_PROMPT, "/tmp/at-state", { providers });
    expect(captured).toBe(TEST_PROMPT);
  });

  it("passes AbortSignal to provider methods", async () => {
    let availSig: AbortSignal | undefined;
    let genSig: AbortSignal | undefined;
    const providers = [
      makeProvider({
        name: "spy",
        async isAvailable(sig: AbortSignal) {
          availSig = sig;
          return true;
        },
        async generate(_prompt: string, sig: AbortSignal) {
          genSig = sig;
          return "add-error-handling-to-api";
        },
      }),
    ];
    const controller = new AbortController();
    await generateSessionName(TEST_PROMPT, "/tmp/at-state", { providers, signal: controller.signal });
    expect(availSig).toBe(controller.signal);
    expect(genSig).toBe(controller.signal);
  });

  it("uses provided fallbackName from opts", async () => {
    const result = await generateSessionName(TEST_PROMPT, "/tmp/at-state", {
      providers: [
        makeProvider({
          name: "a",
          async generate() {
            return null;
          },
        }),
      ],
      fallbackName: "custom-fallback",
    });
    expect(result.name).toBe("custom-fallback");
  });

  it("concatenates opts.context into the provider prompt", async () => {
    let captured = "";
    const providers = [
      makeProvider({
        name: "spy",
        async generate(prompt: string) {
          captured = prompt;
          return "reflective-name";
        },
      }),
    ];
    await generateSessionName(TEST_PROMPT, "/tmp/at-state", {
      providers,
      context: "--- run log tail ---\nfixed the auth bug",
    });
    expect(captured).toBe(`${TEST_PROMPT}\n\n--- run log tail ---\nfixed the auth bug`);
  });

  it("keeps the prompt verbatim when no context is given", async () => {
    let captured = "";
    const providers = [
      makeProvider({
        name: "spy",
        async generate(prompt: string) {
          captured = prompt;
          return "plain-name";
        },
      }),
    ];
    await generateSessionName(TEST_PROMPT, "/tmp/at-state", { providers });
    expect(captured).toBe(TEST_PROMPT);
  });

  it("truncates prompt+context to NAMER_PROMPT_MAX_CHARS", async () => {
    let captured = "";
    const providers = [
      makeProvider({
        name: "spy",
        async generate(prompt: string) {
          captured = prompt;
          return "short-name";
        },
      }),
    ];
    await generateSessionName(TEST_PROMPT, "/tmp/at-state", {
      providers,
      context: "x".repeat(2000),
    });
    expect(captured.length).toBeLessThanOrEqual(NAMER_PROMPT_MAX_CHARS);
    expect(captured.startsWith(TEST_PROMPT)).toBe(true);
  });

  it("quiet:true suppresses provider warnings", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const providers = [
      makeProvider({
        name: "a",
        async generate() {
          return null;
        },
      }),
    ];
    await generateSessionName(TEST_PROMPT, "/tmp/at-state", { providers, quiet: true });
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
