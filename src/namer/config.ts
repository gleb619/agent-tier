/**
 * Settings loaders for the namer (T06).
 *
 * - `loadNamerConfig(stateDir)` reads `~/.at/namer.json` (or
 *   `AT_NAMER_CONFIG` override). ENOENT / parse error → embedded default
 *   (single-provider local-ollama, back-compat).
 * - `loadSecrets(stateDir)` reads `~/.at/secrets.json` (or
 *   `AT_NAMER_SECRETS` override). ENOENT → `{}`. Mode > 0o600 → refuse +
 *   warn + return `{}`. Never logs the resolved map.
 * - `resolveSecret(ref, secrets)` checks env first
 *   (`process.env[ref.toUpperCase().replace(/-/g,'_')]`), then the secrets
 *   map.
 *
 * Validation drops malformed provider entries with a console.warn, never
 * throws — the orchestrator must always get something it can run.
 */

import type { Stats } from "node:fs";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { DEFAULT_NAMER_CONFIG } from "./default-config";
import type { NamerConfig } from "./types";
import { KNOWN_NAMER_PROVIDER_KINDS, type NamerProviderKind } from "./types";

export type { NamerConfig } from "./types";

const SAFE_MODE_MASK = 0o077; // any group/other bit set → refuse

export async function loadNamerConfig(stateDir: string): Promise<NamerConfig> {
  const file = resolveConfigPath(stateDir);
  if (!file) return DEFAULT_NAMER_CONFIG;

  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch (err) {
    if (isEnoent(err)) return DEFAULT_NAMER_CONFIG;
    console.warn(`[at] namer: failed to read ${file}: ${(err as Error).message}; using default`);
    return DEFAULT_NAMER_CONFIG;
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch (err) {
    console.warn(`[at] namer: failed to parse ${file}: ${(err as Error).message}; using default`);
    return DEFAULT_NAMER_CONFIG;
  }

  return validateConfig(body);
}

export async function loadSecrets(stateDir: string): Promise<Record<string, string>> {
  const file = resolveSecretsPath(stateDir);
  if (!file) return {};

  let stResult: Stats;
  try {
    stResult = statSync(file);
  } catch (err) {
    if (isEnoent(err)) return {};
    console.warn(`[at] namer: failed to stat ${file}: ${(err as Error).message}; skipping`);
    return {};
  }

  if ((stResult.mode & SAFE_MODE_MASK) !== 0) {
    console.warn(
      `[at] namer: refusing to read group/world-writable secrets file ${file} (mode 0o${stResult.mode.toString(8)}); expected 0o600`,
    );
    return {};
  }

  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch (err) {
    console.warn(`[at] namer: failed to read ${file}: ${(err as Error).message}; skipping`);
    return {};
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch (err) {
    console.warn(`[at] namer: failed to parse ${file}: ${(err as Error).message}; skipping`);
    return {};
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
    if (typeof v === "string") out[k] = v;
  }
  return out;
}

export function resolveSecret(ref: string, secrets: Record<string, string>): string | undefined {
  const envName = ref.toUpperCase().replace(/-/g, "_");
  const envVal = process.env[envName];
  if (typeof envVal === "string" && envVal.length > 0) return envVal;
  return secrets[ref];
}

// ---------------- helpers ----------------

function resolveConfigPath(stateDir: string): string | null {
  const override = process.env.AT_NAMER_CONFIG;
  if (override && override.trim().length > 0) return override;
  return path.join(stateDir, "namer.json");
}

function resolveSecretsPath(stateDir: string): string | null {
  const override = process.env.AT_NAMER_SECRETS;
  if (override && override.trim().length > 0) return override;
  return path.join(stateDir, "secrets.json");
}

function isEnoent(err: unknown): boolean {
  return !!err && typeof err === "object" && (err as NodeJS.ErrnoException).code === "ENOENT";
}

function validateConfig(body: unknown): NamerConfig {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    console.warn("[at] namer: config root is not an object; using default");
    return DEFAULT_NAMER_CONFIG;
  }
  const root = body as Record<string, unknown>;
  const rawProviders = Array.isArray(root.providers) ? root.providers : [];

  const providers: NamerConfig["providers"] = [];
  for (const entry of rawProviders) {
    const p = validateProvider(entry);
    if (p) providers.push(p);
  }

  return {
    providers: providers.length > 0 ? providers : DEFAULT_NAMER_CONFIG.providers,
    fallbackName: typeof root.fallbackName === "string" ? root.fallbackName : DEFAULT_NAMER_CONFIG.fallbackName,
  };
}

function validateProvider(entry: unknown): NamerConfig["providers"][number] | null {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    console.warn("[at] namer: dropping non-object provider entry");
    return null;
  }
  const e = entry as Record<string, unknown>;
  const type = e.type;
  const name = e.name;
  if (typeof name !== "string" || name.length === 0) {
    console.warn("[at] namer: dropping provider with missing name");
    return null;
  }
  if (typeof type !== "string" || !(KNOWN_NAMER_PROVIDER_KINDS as readonly string[]).includes(type)) {
    console.warn(`[at] namer: dropping provider "${name}" with unknown type "${String(type)}"`);
    return null;
  }
  const kind = type as NamerProviderKind;
  const timeoutMs = typeof e.timeoutMs === "number" ? e.timeoutMs : 3000;
  const model = typeof e.model === "string" ? e.model : "gemma3:1b";

  if (kind === "ollama") {
    if (typeof e.url !== "string") {
      console.warn(`[at] namer: dropping provider "${name}" (ollama missing url)`);
      return null;
    }
    return { name, type: kind, url: e.url, model, timeoutMs };
  }
  if (kind === "openrouter") {
    if (typeof e.url !== "string") {
      console.warn(`[at] namer: dropping provider "${name}" (openrouter missing url)`);
      return null;
    }
    return { name, type: kind, url: e.url, model, apiKeyRef: e.apiKeyRef as string | undefined, timeoutMs };
  }
  return null;
}
