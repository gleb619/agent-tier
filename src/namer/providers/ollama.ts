/**
 * Ollama-backed session namer (T02).
 *
 * Plain local-ollama provider. Implements `NamerProvider`. Probes
 * `GET /api/tags` for availability, posts to `/api/generate` for naming.
 */

import type { NamerProvider } from '../types';
import { fetchWithTimeout } from './shared';

export const NAMER_MIN_LEN = 20;
export const NAMER_MAX_LEN = 40;
export const DEFAULT_NAMER_URL = 'http://localhost:11434';
export const DEFAULT_NAMER_MODEL = 'gemma3:1b';
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
  'You generate short, kebab-case session names (lowercase letters, digits, hyphens, 20-40 chars). ' +
  'Reply with ONLY the name, no quotes, no punctuation, no explanation. ' +
  'If the prompt is ambiguous, pick a short descriptive label. ' +
  'Never exceed 40 characters. Never go below 20 characters.';

/** Normalize model output to a 20-40 char kebab-case token. Returns null if unrecoverable. */
export function sanitizeName(raw: string): string | null {
  if (typeof raw !== 'string') return null;
  let s = raw.trim();

  // Strip common code-fence / quote wrappers the model sometimes returns.
  s = s.replace(/^\s*```\s*/i, '').replace(/\s*```\s*$/, '');
  s = s.replace(/^["'`]+|["'`]+$/g, '');

  // Collapse to allowed characters: [a-z0-9-]
  s = s.toLowerCase();
  s = s.replace(/[^a-z0-9-]+/g, '-');
  s = s.replace(/-+/g, '-');
  s = s.replace(/^-+|-+$/g, '');

  if (s.length === 0) return null;
  if (s.length < NAMER_MIN_LEN) return null; // too short to be a useful name
  if (s.length > NAMER_MAX_LEN) {
    // Prefer cutting on a hyphen boundary so the result still looks like a name.
    const cut = s.slice(0, NAMER_MAX_LEN);
    const lastDash = cut.lastIndexOf('-');
    s = lastDash >= NAMER_MIN_LEN - 1 ? cut.slice(0, lastDash) : cut;
  }
  return s;
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
    this.name = opts.name ?? 'local-ollama';
    this.url = (opts.url ?? process.env.AT_NAMER_URL ?? DEFAULT_NAMER_URL).replace(/\/+$/, '');
    this.model = opts.model ?? process.env.AT_NAMER_MODEL ?? DEFAULT_NAMER_MODEL;
    this.timeoutMs = opts.timeoutMs ?? (Number(process.env.AT_NAMER_TIMEOUT_MS) || DEFAULT_NAMER_TIMEOUT_MS);
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  }

  /** Probe `GET /api/tags` — true if 2xx. Used by orchestrator as cheap health check. */
  async isAvailable(signal: AbortSignal): Promise<boolean> {
    if (typeof this.fetchImpl !== 'function') return false;
    try {
      const res = await fetchWithTimeout(`${this.url}/api/tags`, { method: 'GET' }, {
        timeoutMs: this.timeoutMs,
        signal,
        fetchImpl: this.fetchImpl,
      });
      return !!res && res.ok === true;
    } catch {
      return false;
    }
  }

  /** POST to `/api/generate`, sanitize response. Never throws — returns null on any failure. */
  async generate(prompt: string, signal: AbortSignal): Promise<string | null> {
    if (!prompt || !prompt.trim()) return null;
    if (typeof this.fetchImpl !== 'function') return null;

    try {
      const res = await fetchWithTimeout(`${this.url}/api/generate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          prompt: `${SYSTEM_PROMPT}\n\nPrompt:\n${prompt.slice(0, NAMER_PROMPT_MAX_CHARS)}\n\nName:`,
          stream: false,
          // gemma3/gemma4-class models are *thinking* models: without this the whole
          // num_predict budget goes to reasoning and `response` comes back empty.
          think: false,
          options: { temperature: 0.2, num_predict: 64 },
        }),
      }, {
        timeoutMs: this.timeoutMs,
        signal,
        fetchImpl: this.fetchImpl,
      });

      if (!res || res.ok !== true) return null;
      const body = (await res.json().catch(() => null)) as OllamaGenerateResponse | null;
      if (!body || typeof body.response !== 'string') return null;
      if (body.error) return null;

      return sanitizeName(body.response);
    } catch {
      return null;
    }
  }
}
