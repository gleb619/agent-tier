/**
 * Ollama-backed session namer (T02).
 *
 * Plain local-ollama provider. Implements `NamerProvider`. Probes
 * `GET /api/tags` for availability, posts to `/api/generate` for naming.
 */

import type { NamerProvider } from "../types";
import { fetchWithTimeout } from "./shared";

export const NAMER_MIN_LEN = 20;
export const NAMER_MAX_LEN = 40;
/**
 * Floor for *salvaged* names only. When the prompt offers no more keywords to
 * pad with, a name built from real model output + real prompt words is still
 * descriptive well below `NAMER_MIN_LEN` (`test-hello-world`), and far more
 * useful than discarding it and persisting `unnamed`. Garbage this short (a
 * lone `x`) is still rejected.
 */
export const NAMER_SALVAGE_MIN_LEN = 8;
export const DEFAULT_NAMER_URL = "http://localhost:11434";
export const DEFAULT_NAMER_MODEL = "gemma3:1b";
export const DEFAULT_NAMER_TIMEOUT_MS = 5000;
/** Only the head of the prompt is sent — a 7 KB task file names no better than its first 400 chars, and costs 3-5x the latency. */
export const NAMER_PROMPT_MAX_CHARS = 400;

export interface NamerOptions {
  url?: string;
  model?: string;
  timeoutMs?: number;
  /** Injectable fetch for tests. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

const SYSTEM_PROMPT =
  "You generate short, kebab-case session names (lowercase letters, digits, hyphens, 20-40 chars). " +
  "Reply with ONLY the name, no quotes, no punctuation, no explanation. " +
  "If the prompt is ambiguous, pick a short descriptive label. " +
  "Never exceed 40 characters. Never go below 20 characters.";

/**
 * Filler words that carry no naming signal. Used only when a too-short model
 * answer has to be padded back up to `NAMER_MIN_LEN`.
 */
const NAME_STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "that",
  "this",
  "from",
  "into",
  "onto",
  "only",
  "please",
  "make",
  "need",
  "want",
  "some",
  "very",
  "also",
  "then",
  "than",
  "when",
  "where",
  "which",
  "while",
  "your",
  "you",
  "our",
  "its",
  "are",
  "was",
  "were",
  "has",
  "have",
  "had",
  "not",
  "but",
  "all",
  "any",
  "can",
  "could",
  "should",
  "would",
  "will",
  "may",
  "might",
  "must",
  "does",
  "did",
  "done",
  "todo",
  "task",
  "work",
  "file",
  "files",
  "code",
  "repo",
  "add",
  "fix",
]);

/** Lowercase kebab normalization with no length gate. Empty string when nothing survives. */
function kebabCore(raw: string): string {
  let s = raw.trim();

  // Strip common code-fence / quote wrappers the model sometimes returns.
  s = s.replace(/^\s*```\s*/i, "").replace(/\s*```\s*$/, "");
  s = s.replace(/^["'`]+|["'`]+$/g, "");

  // Collapse to allowed characters: [a-z0-9-]
  s = s.toLowerCase();
  s = s.replace(/[^a-z0-9-]+/g, "-");
  s = s.replace(/-+/g, "-");
  s = s.replace(/^-+|-+$/g, "");
  return s;
}

/** Clamp an over-long name to NAMER_MAX_LEN, preferring a hyphen boundary. */
function fitLength(s: string): string {
  if (s.length <= NAMER_MAX_LEN) return s;
  const cut = s.slice(0, NAMER_MAX_LEN);
  const lastDash = cut.lastIndexOf("-");
  return lastDash >= NAMER_MIN_LEN - 1 ? cut.slice(0, lastDash) : cut;
}

/** Normalize model output to a 20-40 char kebab-case token. Returns null if unrecoverable. */
export function sanitizeName(raw: string): string | null {
  if (typeof raw !== "string") return null;
  const s = kebabCore(raw);
  if (s.length === 0) return null;
  if (s.length < NAMER_MIN_LEN) return null; // too short to be a useful name
  return fitLength(s);
}

/** Salient prompt words, in order of appearance, de-duplicated. */
function promptKeywords(prompt: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const word of prompt.toLowerCase().split(/[^a-z0-9]+/)) {
    if (word.length < 3 || NAME_STOPWORDS.has(word) || seen.has(word)) continue;
    seen.add(word);
    out.push(word);
  }
  return out;
}

/**
 * `sanitizeName` with a salvage path for undersized answers.
 *
 * Small local models routinely ignore the "20-40 chars" instruction and reply
 * with a perfectly good short label — `Auth-token-v2`, `test-hello`,
 * `smoke test return`. `sanitizeName` throws those away, so every provider
 * fails and the run is persisted as `unnamed` forever. Instead of discarding
 * the model's intent, keep its tokens as the prefix and pad with salient words
 * from the prompt until the name reaches `NAMER_MIN_LEN`.
 *
 * Returns null only when the raw answer carries no usable characters at all
 * (empty, whitespace, punctuation-only) — the same cases `sanitizeName` rejects.
 */
export function deriveName(raw: string, prompt: string): string | null {
  if (typeof raw !== "string") return null;

  // A compliant answer is used verbatim — no prompt keyword can improve it.
  const strict = sanitizeName(raw);
  if (strict) return strict;

  const core = kebabCore(raw);
  if (core.length === 0) return null;

  const parts = core.split("-").filter(Boolean);
  for (const word of promptKeywords(prompt)) {
    if (parts.includes(word)) continue;
    parts.push(word);
    if (parts.join("-").length >= NAMER_MIN_LEN) break;
  }

  const joined = parts.join("-");
  // Keywords exhausted before reaching NAMER_MIN_LEN: keep the salvaged name
  // when it is still recognisably a label, else reject (a lone `x` is noise).
  if (joined.length >= NAMER_SALVAGE_MIN_LEN) return joined;
  return null;
}

interface OllamaGenerateResponse {
  response?: string;
  model?: string;
  error?: string;
}

export class OllamaProvider implements NamerProvider {
  readonly name: string;
  private readonly url: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: NamerOptions & { name?: string } = {}) {
    this.name = opts.name ?? "local-ollama";
    this.url = (opts.url ?? process.env.AT_NAMER_URL ?? DEFAULT_NAMER_URL).replace(/\/+$/, "");
    this.model = opts.model ?? process.env.AT_NAMER_MODEL ?? DEFAULT_NAMER_MODEL;
    this.timeoutMs = opts.timeoutMs ?? (Number(process.env.AT_NAMER_TIMEOUT_MS) || DEFAULT_NAMER_TIMEOUT_MS);
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  }

  /** Probe `GET /api/tags` — true if 2xx. Used by orchestrator as cheap health check. */
  async isAvailable(signal: AbortSignal): Promise<boolean> {
    if (typeof this.fetchImpl !== "function") return false;
    try {
      const res = await fetchWithTimeout(
        `${this.url}/api/tags`,
        { method: "GET" },
        {
          timeoutMs: this.timeoutMs,
          signal,
          fetchImpl: this.fetchImpl,
        },
      );
      return !!res && res.ok === true;
    } catch {
      return false;
    }
  }

  /** POST to `/api/generate`, sanitize response. Never throws — returns null on any failure. */
  async generate(prompt: string, signal: AbortSignal): Promise<string | null> {
    if (!prompt?.trim()) return null;
    if (typeof this.fetchImpl !== "function") return null;

    try {
      const res = await fetchWithTimeout(
        `${this.url}/api/generate`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            model: this.model,
            prompt: `${SYSTEM_PROMPT}\n\nPrompt:\n${prompt.slice(0, NAMER_PROMPT_MAX_CHARS)}\n\nName:`,
            stream: false,
            // gemma3/gemma4-class models are *thinking* models: without this the whole
            // num_predict budget goes to reasoning and `response` comes back empty.
            think: false,
            options: { temperature: 0.2, num_predict: 64 },
          }),
        },
        {
          timeoutMs: this.timeoutMs,
          signal,
          fetchImpl: this.fetchImpl,
        },
      );

      if (res?.ok !== true) return null;
      const body = (await res.json().catch(() => null)) as OllamaGenerateResponse | null;
      if (!body || typeof body.response !== "string") return null;
      if (body.error) return null;

      return deriveName(body.response, prompt);
    } catch {
      return null;
    }
  }
}
