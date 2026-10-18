/**
 * `~/.at/triage.json` — catalog of model providers for `at triage`, modelled on `namer.json`.
 *
 *   {
 *     "use": ["borispc3", "local-ollama"],        // one name or an ordered fallback list; absent = heuristic only
 *     "providers": [
 *       { "name": "local-ollama", "type": "ollama", "url": "http://localhost:11434", "model": "tev1:0.8b" },
 *       { "name": "borispc3", "type": "ollama", "url": "http://borispc3.ai:7869", "model": "tev1:latest", "timeoutMs": 4000 },
 *       { "name": "openrouter", "type": "openrouter", "url": "https://openrouter.ai/api/v1",
 *         "model": "meta-llama/llama-3.2-3b-instruct", "apiKeyRef": "openrouter-api-key" }
 *     ]
 *   }
 *
 * `apiKeyRef` resolves like the namer's: env `OPENROUTER_API_KEY` (ref upper-cased, `-`→`_`), then
 * `secrets.json`. Never throws: a missing/corrupt file just means "no providers".
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { loadSecrets, resolveSecret } from "../namer/config";
import {
  DEFAULT_OPENROUTER_MODEL,
  DEFAULT_TEV1_MODEL,
  DEFAULT_TEV1_TIMEOUT_MS,
  DEFAULT_TEV1_TTL_MS,
  resolveModelConfig,
  type Tev1Options,
} from "./model";

export const TRIAGE_PROVIDER_TYPES = ["ollama", "openrouter"] as const;
export type TriageProviderType = (typeof TRIAGE_PROVIDER_TYPES)[number];

export interface TriageProviderConfig {
  name: string;
  type: TriageProviderType;
  url: string;
  model?: string;
  apiKeyRef?: string;
  timeoutMs?: number;
  ttlMs?: number;
}

export interface TriageConfig {
  use: string[];
  providers: TriageProviderConfig[];
}

const EMPTY: TriageConfig = { use: [], providers: [] };

export function triageConfigPath(stateDir: string, env: NodeJS.ProcessEnv = process.env): string {
  const override = env.AT_TRIAGE_CONFIG;
  return override?.trim() ? override : path.join(stateDir, "triage.json");
}

function names(v: unknown): string[] {
  const list = typeof v === "string" ? v.split(",") : Array.isArray(v) ? v : [];
  return list
    .filter((n): n is string => typeof n === "string")
    .map((n) => n.trim())
    .filter(Boolean);
}

function validateProvider(entry: unknown): TriageProviderConfig | null {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
  const e = entry as Record<string, unknown>;
  if (typeof e.name !== "string" || !e.name) return null;
  if (!(TRIAGE_PROVIDER_TYPES as readonly string[]).includes(e.type as string)) {
    console.warn(`[at] triage: dropping provider "${e.name}" with unknown type "${String(e.type)}"`);
    return null;
  }
  if (typeof e.url !== "string" || !e.url) {
    console.warn(`[at] triage: dropping provider "${e.name}" (missing url)`);
    return null;
  }
  const num = (v: unknown) => (typeof v === "number" && v > 0 ? v : undefined);
  return {
    name: e.name,
    type: e.type as TriageProviderType,
    url: e.url,
    model: typeof e.model === "string" ? e.model : undefined,
    apiKeyRef: typeof e.apiKeyRef === "string" ? e.apiKeyRef : undefined,
    timeoutMs: num(e.timeoutMs),
    ttlMs: num(e.ttlMs),
  };
}

export function loadTriageConfig(stateDir: string, env: NodeJS.ProcessEnv = process.env): TriageConfig {
  const file = triageConfigPath(stateDir, env);
  let body: unknown;
  try {
    body = JSON.parse(readFileSync(file, "utf8"));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn(`[at] triage: failed to read ${file}: ${(err as Error).message}; ignoring`);
    }
    return EMPTY;
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return EMPTY;
  const root = body as Record<string, unknown>;
  const providers = (Array.isArray(root.providers) ? root.providers : [])
    .map(validateProvider)
    .filter((p): p is TriageProviderConfig => p !== null);
  return { use: names(root.use), providers };
}

export function providerToOptions(
  p: TriageProviderConfig,
  stateDir: string,
  secrets: Record<string, string>,
): Tev1Options | { error: string } {
  const apiKey = p.apiKeyRef ? resolveSecret(p.apiKeyRef, secrets) : undefined;
  if (p.type === "openrouter" && !apiKey) {
    return {
      error: `${p.name}: openrouter needs apiKeyRef (env ${p.apiKeyRef?.toUpperCase().replace(/-/g, "_") ?? "…"} or secrets.json)`,
    };
  }
  return {
    name: p.name,
    provider: p.type === "openrouter" ? "openrouter" : "remote-ollama",
    url: p.url,
    model: p.model ?? (p.type === "openrouter" ? DEFAULT_OPENROUTER_MODEL : DEFAULT_TEV1_MODEL),
    apiKey,
    timeoutMs: p.timeoutMs ?? DEFAULT_TEV1_TIMEOUT_MS,
    ttlMs: p.ttlMs ?? DEFAULT_TEV1_TTL_MS,
    stateDir,
  };
}

export interface ResolvedProviders {
  models: Tev1Options[];
  /** Config problems (unknown name, missing key) — surfaced as a `note`, never fatal. */
  errors: string[];
}

/**
 * Which providers to try, in order. Selection: `--provider` flag > `AT_TRIAGE_PROVIDER` env
 * (`AT_TRIAGE_TEV1=1` = local-ollama) > `use` in triage.json. Each name is looked up in the file
 * first, then among the env presets `local-ollama` / `remote-ollama` / `openrouter`.
 */
export async function resolveTriageProviders(
  stateDir: string,
  flag?: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<ResolvedProviders> {
  const cfg = loadTriageConfig(stateDir, env);
  const selected = names(flag ?? env.AT_TRIAGE_PROVIDER);
  if (selected.length === 0 && /^(1|true|yes|on)$/i.test(env.AT_TRIAGE_TEV1 ?? "")) selected.push("local-ollama");
  const wanted = selected.length > 0 ? selected : cfg.use;
  const out: ResolvedProviders = { models: [], errors: [] };
  if (wanted.length === 0) return out;

  const secrets = await loadSecrets(stateDir);
  for (const name of wanted) {
    const fromFile = cfg.providers.find((p) => p.name === name);
    if (fromFile) {
      const o = providerToOptions(fromFile, stateDir, secrets);
      if ("error" in o) out.errors.push(o.error);
      else out.models.push(o);
      continue;
    }
    const preset = resolveModelConfig(env, stateDir, name);
    if (preset && "opts" in preset) out.models.push({ ...preset.opts, name });
    else out.errors.push(preset && "error" in preset ? preset.error : `unknown triage provider "${name}"`);
  }
  return out;
}
