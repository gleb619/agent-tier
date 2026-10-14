import { loadGenericAgents } from "./agents/generic-loader";
import type { AgentDef } from "./agents/registry";
import { AGENTS } from "./agents/registry";
import type { AtConfig } from "./config";
import { verifyConfigBytes } from "./config";
import { connectDaemon, daemonRunning, isDaemonDisabled } from "./daemon-client";
import type { HealthState } from "./health";
import type { RunRecord } from "./run-store";
import type { StateFile } from "./scheduler";

/**
 * Read-through helpers for the `atd` hot caches (T35).
 *
 * Every reader is best-effort and returns `null` whenever the daemon is
 * unavailable, slow, or answers with something it should not — callers then
 * fall back to their own direct file read. The caches only ever remove work,
 * never add a failure mode. Writes stay with the locked TS stores (T36 owns
 * routing them through the daemon).
 */

/** Kinds the daemon caches, each also its socket command (see web-server/internal/daemon/cache.go). */
export type CacheKind = "runs" | "state" | "health" | "config" | "bins";

/** `cache-stats` is the daemon's read-only introspection command, not a kind. */
export type CacheCmd = CacheKind | "cache-stats";

export interface CacheValue<T> {
  data: T;
  /** True when `atd` served the value without re-reading the source files. */
  cached: boolean;
}

export interface DaemonCacheStats {
  hits: number;
  misses: number;
  invalidations: number;
  entries: number;
  watched: string[];
}

interface ConfigBytes {
  text?: string;
  hmac?: string;
}

export interface ReadCacheOptions {
  /** State dir to read (project-local `.at/` vs the daemon's own `~/.at`). */
  dir?: string;
  /** Kind-specific request fields, sent as top-level JSON like `dir`. */
  extra?: Record<string, unknown>;
  /** Socket timeout; short by design — a cache miss must not slow the CLI down. */
  timeoutMs?: number;
}

/** One hot-cache read. Never throws: `null` means "read it yourself". */
export async function readCache<T>(cmd: CacheCmd, opts: ReadCacheOptions = {}): Promise<CacheValue<T> | null> {
  const payload: Record<string, unknown> = { ...opts.extra };
  if (opts.dir) payload.dir = opts.dir;
  const resp = await connectDaemon(cmd, payload, opts.timeoutMs ?? 400);
  if (!resp?.ok || resp.data === undefined) return null;
  return { data: resp.data as T, cached: resp.cached === true };
}

/** Runs index (`runs.jsonl`, legacy `{"runs":[…]}` already flattened by the daemon). */
export async function cachedRuns(stateDir: string): Promise<RunRecord[] | null> {
  const res = await readCache<RunRecord[]>("runs", { dir: stateDir });
  if (!res || !Array.isArray(res.data)) return null;
  return res.data.filter((r): r is RunRecord => !!r && typeof r === "object" && typeof r.runId === "string");
}

/** `state.json` as a whole — scheduler indexes + runs settings + agent health. */
export async function cachedState(stateDir: string): Promise<StateFile | null> {
  const res = await readCache<StateFile>("state", { dir: stateDir });
  if (!res || typeof res.data !== "object" || res.data === null || Array.isArray(res.data)) return null;
  return res.data;
}

/** The `agents` block of `state.json`, matching `loadHealth`'s shape. */
export async function cachedHealth(stateDir: string): Promise<HealthState | null> {
  const res = await readCache<HealthState>("health", { dir: stateDir });
  if (!res || typeof res.data !== "object" || res.data === null) return null;
  const agents = (res.data as HealthState).agents;
  if (typeof agents !== "object" || agents === null || Array.isArray(agents)) return null;
  return { ...res.data, agents };
}

/**
 * `config.json` fetched as raw bytes and verified here with the same HMAC check
 * `loadConfig` runs. `undefined` = no usable cache answer (fall back to disk);
 * `null` = verified answer with no usable config (missing HMAC / tampered).
 */
export async function cachedConfig(opts?: { quiet?: boolean }): Promise<AtConfig | null | undefined> {
  const res = await readCache<ConfigBytes>("config");
  const text = res?.data?.text;
  if (!res || typeof text !== "string" || text === "") return undefined;
  return verifyConfigBytes(text, typeof res.data?.hmac === "string" ? res.data.hmac : null, opts);
}

export type BinResolution = Record<string, string | null>;

/** Ask the daemon which candidate path (if any) exists for each agent name. */
export async function cachedBinResolution(candidates: Record<string, string[]>): Promise<BinResolution | null> {
  const res = await readCache<BinResolution>("bins", { extra: { candidates } });
  if (!res || typeof res.data !== "object" || res.data === null || Array.isArray(res.data)) return null;
  const out: BinResolution = {};
  for (const name of Object.keys(candidates)) {
    const v = (res.data as BinResolution)[name];
    if (v === undefined) return null; // partial answer ⇒ unusable
    out[name] = typeof v === "string" ? v : null;
  }
  return out;
}

/** Read/miss/invalidation counters (`at daemon cache`). */
export async function cacheStats(): Promise<DaemonCacheStats | null> {
  const res = await readCache<DaemonCacheStats>("cache-stats" as CacheKind);
  if (!res || typeof res.data !== "object" || res.data === null) return null;
  const d = res.data as DaemonCacheStats;
  if (typeof d.hits !== "number" || typeof d.misses !== "number") return null;
  return { ...d, watched: Array.isArray(d.watched) ? d.watched : [] };
}

/**
 * Candidate binary paths per registered agent — the daemon caches the existence
 * answers, the registry stays the only source of truth for what to look for.
 */
export function agentBinCandidates(agents: AgentDef[] = [...AGENTS, ...loadGenericAgents()]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const a of agents) {
    try {
      out[a.name] = [a.bin()];
    } catch {}
  }
  return out;
}

/** Cheap pre-check so CLI code can say "no daemon" without opening a socket. */
export function daemonCacheReachable(): boolean {
  return !isDaemonDisabled() && daemonRunning();
}
