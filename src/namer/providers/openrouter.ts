/**
 * OpenRouter provider (T03) — chat/completions against an OpenAI-compatible
 * endpoint. Free-tier friendly: a small model + short prompt keeps the bill
 * at zero on openrouter's `*::free` tier.
 *
 * API key is resolved by the registry (T07) from `secrets.json` / env at
 * provider-build time. If undefined, `isAvailable` returns false so the
 * orchestrator skips this provider entirely.
 */

import type { NamerProvider } from "../types";
import { deriveName } from "./ollama";
import { fetchWithTimeout } from "./shared";

export interface OpenRouterOptions {
  name?: string;
  url: string;
  model: string;
  /** Pre-resolved by the registry from secrets.json / env. undefined → skipped. */
  apiKey: string | undefined;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

interface OpenRouterResponse {
  choices?: Array<{ message?: { role?: string; content?: unknown } }>;
  error?: { message?: string; code?: number };
}

const DEFAULT_TIMEOUT_MS = 4000;
const DEFAULT_NAME = "openrouter";

export class OpenRouterProvider implements NamerProvider {
  readonly name: string;
  private readonly url: string;
  private readonly model: string;
  private readonly apiKey: string | undefined;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: OpenRouterOptions) {
    this.name = opts.name ?? DEFAULT_NAME;
    this.url = opts.url;
    this.model = opts.model;
    this.apiKey = opts.apiKey;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  }

  /** No key → skip. The orchestrator will move on. */
  async isAvailable(_signal: AbortSignal): Promise<boolean> {
    return typeof this.apiKey === "string" && this.apiKey.length > 0;
  }

  /** POST chat/completions; never throws. */
  async generate(prompt: string, signal: AbortSignal): Promise<string | null> {
    if (!prompt?.trim()) return null;
    if (!this.apiKey) return null;
    if (typeof this.fetchImpl !== "function") return null;

    try {
      const res = await fetchWithTimeout(
        this.url,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${this.apiKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model: this.model,
            messages: [{ role: "user", content: prompt }],
            stream: false,
          }),
        },
        {
          timeoutMs: this.timeoutMs,
          signal,
          fetchImpl: this.fetchImpl,
        },
      );

      if (res?.ok !== true) return null;
      const body = (await res.json().catch(() => null)) as OpenRouterResponse | null;
      if (!body || !Array.isArray(body.choices) || body.choices.length === 0) return null;

      const content = body.choices[0]?.message?.content;
      if (typeof content !== "string") return null;

      return deriveName(content, prompt);
    } catch {
      return null;
    }
  }
}
