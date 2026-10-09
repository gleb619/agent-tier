/**
 * Ollama-backed session namer (experimental).
 *
 * Calls a local Ollama instance (default: http://localhost:11434) to ask a
 * small text model for a short kebab-case session name (20-40 chars) derived
 * from the user's prompt. Returns null on any failure (network, model
 * missing, malformed output) so the caller can fall back silently — the
 * namer is an enrichment, never a blocker.
 *
 * Used by the `at` CLI when invoked with `--namer`. The generated name is
 * persisted on the run record and surfaced in `at status`.
 */

export const NAMER_MIN_LEN = 20;
export const NAMER_MAX_LEN = 40;
export const DEFAULT_NAMER_URL = 'http://localhost:11434';
export const DEFAULT_NAMER_MODEL = 'gemma3:1b';
export const DEFAULT_NAMER_TIMEOUT_MS = 5000;

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

/**
 * Ask Ollama to name the session for `prompt`. Returns null on any failure
 * (timeout, HTTP error, missing model, malformed body, unrecoverable output).
 */
export async function generateSessionName(
  prompt: string,
  options: NamerOptions = {},
): Promise<string | null> {
  if (!prompt || !prompt.trim()) return null;

  const url = (options.url ?? process.env.AT_NAMER_URL ?? DEFAULT_NAMER_URL).replace(/\/+$/, '');
  const model = options.model ?? process.env.AT_NAMER_MODEL ?? DEFAULT_NAMER_MODEL;
  const timeoutMs = options.timeoutMs ?? (Number(process.env.AT_NAMER_TIMEOUT_MS) || DEFAULT_NAMER_TIMEOUT_MS);
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;

  if (typeof fetchImpl !== 'function') return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetchImpl(`${url}/api/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        prompt: `${SYSTEM_PROMPT}\n\nPrompt:\n${prompt}\n\nName:`,
        stream: false,
        options: { temperature: 0.2, num_predict: 64 },
      }),
      signal: controller.signal,
    });

    if (!res.ok) return null;
    const body = (await res.json().catch(() => null)) as OllamaGenerateResponse | null;
    if (!body || typeof body.response !== 'string') return null;
    if (body.error) return null;

    return sanitizeName(body.response);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
