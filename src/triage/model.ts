/**
 * Optional small-model refinement of the triage heuristic, via one of three providers:
 *  - `local-ollama`  : tev1 decision model on Ollama at localhost (`/v1/systemone`)
 *  - `remote-ollama` : same API on another host (`AT_TRIAGE_URL`, optional bearer key)
 *  - `openrouter`    : chat-completions JSON answer from a small hosted model
 * It must never slow down or break triage: every failure mode (down, hung, model missing, bad
 * JSON) resolves to `{ ok: false }`, and a TTL breaker file makes the next calls skip the model
 * entirely instead of paying the timeout again.
 */

import { spawn } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { writeFileAtomicSync } from "../atomic-write";
import { SIGNALS, type Signal } from "./heuristic";

export const PROVIDERS = ["local-ollama", "remote-ollama", "openrouter"] as const;
export type TriageProvider = (typeof PROVIDERS)[number];

export const DEFAULT_TEV1_URL = "http://localhost:11434";
export const DEFAULT_TEV1_MODEL = "tev1:0.8b";
export const DEFAULT_OPENROUTER_URL = "https://openrouter.ai/api/v1";
export const DEFAULT_OPENROUTER_MODEL = "meta-llama/llama-3.2-3b-instruct";
export const DEFAULT_TEV1_TIMEOUT_MS = 3000;
/** A timeout is usually a cold model load, not an outage: retry soon, and warm the model meanwhile. */
export const TIMEOUT_BREAKER_MS = 30_000;
export const DEFAULT_TEV1_TTL_MS = 5 * 60_000;
/** tev1 runs with ~2k tokens of context: only the head of the prompt is sent. */
export const TEV1_STATE_MAX_CHARS = 1800;
const BREAKER_FILE = "triage-tev1.json";

export interface Tev1Options {
  provider?: TriageProvider;
  url?: string;
  model?: string;
  /** Bearer token: required by openrouter, optional for a remote-ollama behind a proxy. */
  apiKey?: string;
  timeoutMs?: number;
  /** How long a failure keeps the model skipped. */
  ttlMs?: number;
  stateDir: string;
  /** Test seam: fire-and-forget model warm-up after a timeout. Default: detached child process. */
  warm?: (target: { url: string; model: string; apiKey?: string }) => void;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

const QUESTIONS = {
  crossModule: "Does the task touch many files or several modules, rather than one or two files?",
  needsPlan: "Does the task need a design or plan to be written and reviewed before any code?",
  iterative: "Does the task need an iterate-until-tests-pass loop rather than one edit?",
  risky: "Is the change risky or irreversible, such as a data migration, auth, security or concurrency?",
  backlog: "Does the task ask to work through a backlog of several separate tasks?",
} satisfies Record<Signal, string>;

function breakerPath(stateDir: string): string {
  return path.join(stateDir, BREAKER_FILE);
}

/** Epoch ms until which the model is skipped; 0 when the breaker is closed. */
export function breakerDownUntil(stateDir: string): number {
  try {
    const v = (JSON.parse(readFileSync(breakerPath(stateDir), "utf8")) as { downUntil?: unknown }).downUntil;
    return typeof v === "number" ? v : 0;
  } catch {
    return 0;
  }
}

function openBreaker(stateDir: string, until: number, reason: string): void {
  try {
    writeFileAtomicSync(breakerPath(stateDir), `${JSON.stringify({ downUntil: until, reason })}\n`);
  } catch {
    // best effort: a read-only state dir only costs one timeout per call
  }
}

function closeBreaker(stateDir: string): void {
  rmSync(breakerPath(stateDir), { force: true });
}

/** Provider settings from env. `null` = model refinement off. */
export function resolveModelConfig(
  env: NodeJS.ProcessEnv,
  stateDir: string,
  flagProvider?: string,
): { opts: Tev1Options } | { error: string } | null {
  const raw = (
    flagProvider ??
    env.AT_TRIAGE_PROVIDER ??
    (/^(1|true|yes|on)$/i.test(env.AT_TRIAGE_TEV1 ?? "") ? "local-ollama" : "")
  ).trim();
  if (!raw) return null;
  if (!(PROVIDERS as readonly string[]).includes(raw)) {
    return { error: `unknown triage provider "${raw}" (use ${PROVIDERS.join(" | ")})` };
  }
  const provider = raw as TriageProvider;
  const timeoutMs = Number(env.AT_TRIAGE_TIMEOUT_MS) || undefined;
  const ttlMs = Number(env.AT_TRIAGE_TTL_MS) || undefined;
  const model = env.AT_TRIAGE_MODEL || undefined;
  const base = { provider, stateDir, timeoutMs, ttlMs, model };
  if (provider === "local-ollama") return { opts: { ...base, url: env.AT_TRIAGE_URL || DEFAULT_TEV1_URL } };
  if (provider === "remote-ollama") {
    if (!env.AT_TRIAGE_URL) return { error: "remote-ollama needs AT_TRIAGE_URL" };
    return { opts: { ...base, url: env.AT_TRIAGE_URL, apiKey: env.AT_TRIAGE_API_KEY || undefined } };
  }
  const apiKey = env.AT_TRIAGE_API_KEY || env.OPENROUTER_API_KEY;
  if (!apiKey) return { error: "openrouter needs AT_TRIAGE_API_KEY or OPENROUTER_API_KEY" };
  return { opts: { ...base, url: env.AT_TRIAGE_URL || DEFAULT_OPENROUTER_URL, apiKey } };
}

/**
 * Aborting a request cancels Ollama's model load, so a cold model would time out forever. Load it
 * from a detached child that outlives this CLI process (keep_alive keeps it resident afterwards).
 */
function spawnWarmUp({ url, model, apiKey }: { url: string; model: string; apiKey?: string }): void {
  const script = `fetch(process.argv[1] + "/api/generate", { method: "POST", headers: JSON.parse(process.argv[3]), body: JSON.stringify({ model: process.argv[2], keep_alive: "10m" }), signal: AbortSignal.timeout(120000) }).catch(() => {});`;
  const headers = JSON.stringify({
    "Content-Type": "application/json",
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
  });
  try {
    spawn(process.execPath, ["-e", script, url, model, headers], { detached: true, stdio: "ignore" }).unref();
  } catch {
    // warm-up is best effort
  }
}

export type Tev1Probabilities = Partial<Record<Signal, number>>;

export type Tev1Outcome = { ok: true; probs: Tev1Probabilities } | { ok: false; reason: string };

/** Ask tev1 for the five signal probabilities. Never throws, never outlives `timeoutMs`. */
export async function askTev1(prompt: string, opts: Tev1Options): Promise<Tev1Outcome> {
  const now = opts.now ?? Date.now;
  const down = breakerDownUntil(opts.stateDir);
  if (down > now()) return { ok: false, reason: `model skipped (breaker open ${Math.ceil((down - now()) / 1000)}s)` };

  const base = (opts.url ?? DEFAULT_TEV1_URL).replace(/\/+$/, "");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_TEV1_TIMEOUT_MS);
  try {
    const provider = opts.provider ?? "local-ollama";
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (opts.apiKey) headers.Authorization = `Bearer ${opts.apiKey}`;
    const state = prompt.slice(0, TEV1_STATE_MAX_CHARS);
    const openrouter = provider === "openrouter";
    const res = await (opts.fetchImpl ?? fetch)(openrouter ? `${base}/chat/completions` : `${base}/v1/systemone`, {
      method: "POST",
      headers,
      body: JSON.stringify(
        openrouter
          ? {
              model: opts.model ?? DEFAULT_OPENROUTER_MODEL,
              temperature: 0,
              max_tokens: 80,
              response_format: { type: "json_object" },
              messages: [
                {
                  role: "user",
                  content: `${SIGNALS.map((s) => `${s}: ${QUESTIONS[s]}`).join("\n")}\n\nReply ONLY with a JSON object mapping each key above to the probability (0-1) that the answer is yes for this task:\n\n${state}`,
                },
              ],
            }
          : {
              model: opts.model ?? DEFAULT_TEV1_MODEL,
              state,
              keep_alive: "10m",
              questions: Object.fromEntries(SIGNALS.map((s) => [s, { type: "noul", instructions: QUESTIONS[s] }])),
            },
      ),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as Record<string, unknown>;
    const probs = openrouter ? parseChatProbs(body) : parseSystemOneProbs(body);
    if (Object.keys(probs).length === 0) throw new Error("no usable answers");
    closeBreaker(opts.stateDir);
    return { ok: true, probs };
  } catch (err) {
    const timedOut = controller.signal.aborted;
    const reason = timedOut ? "timeout" : err instanceof Error ? err.message : String(err);
    const ttl = opts.ttlMs ?? DEFAULT_TEV1_TTL_MS;
    openBreaker(opts.stateDir, now() + (timedOut ? Math.min(ttl, TIMEOUT_BREAKER_MS) : ttl), reason);
    if (timedOut && opts.provider !== "openrouter") {
      (opts.warm ?? spawnWarmUp)({ url: base, model: opts.model ?? DEFAULT_TEV1_MODEL, apiKey: opts.apiKey });
    }
    return { ok: false, reason: `model unavailable: ${reason}` };
  } finally {
    clearTimeout(timer);
  }
}

function validProb(v: unknown): number | undefined {
  return typeof v === "number" && v >= 0 && v <= 1 ? v : undefined;
}

function parseSystemOneProbs(body: Record<string, unknown>): Tev1Probabilities {
  const answers = (body.answers ?? {}) as Record<string, { noul?: unknown }>;
  const probs: Tev1Probabilities = {};
  for (const s of SIGNALS) {
    const p = validProb(answers[s]?.noul);
    if (p !== undefined) probs[s] = p;
  }
  return probs;
}

function parseChatProbs(body: Record<string, unknown>): Tev1Probabilities {
  const content = (body.choices as Array<{ message?: { content?: string } }> | undefined)?.[0]?.message?.content ?? "";
  const json = /\{[\s\S]*\}/.exec(content)?.[0];
  if (!json) return {};
  const obj = JSON.parse(json) as Record<string, unknown>;
  const probs: Tev1Probabilities = {};
  for (const s of SIGNALS) {
    const p = validProb(obj[s]);
    if (p !== undefined) probs[s] = p;
  }
  return probs;
}

/**
 * A heuristic hit survives unless the model strongly disagrees. The model never ADDS signals: tev1:0.8b
 * is poorly calibrated (measured 0.65–0.95 for crossModule on plain one-file tasks), so model-only
 * signals would escalate simple work — the exact cost this triage exists to avoid.
 */
export const KEEP_MIN_P = 0.4;

export function refineSignals(heuristic: Signal[], probs: Tev1Probabilities): Signal[] {
  return heuristic.filter((s) => (probs[s] ?? 1) >= KEEP_MIN_P);
}
