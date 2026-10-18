/** Parse/format helpers for kanban time estimates and run actuals. Pure; no I/O. */

const UNIT_MS: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
const DURATION_RE = /^(?:\d+(?:\.\d+)?[smhd])+$/i;
const DURATION_PART_RE = /(\d+(?:\.\d+)?)([smhd])/gi;

function blank(v: string | undefined | null): boolean {
  const t = (v ?? "").trim();
  return t === "" || t === "-";
}

/** `45m`, `2h`, `1h30m`, `90s`, `1d` → milliseconds. null for blank/`-`/invalid. */
export function parseDuration(value: string | undefined | null): number | null {
  if (blank(value)) return null;
  const text = String(value).trim().replace(/\s+/g, "");
  if (!DURATION_RE.test(text)) return null;
  let total = 0;
  for (const m of text.matchAll(DURATION_PART_RE)) total += Number(m[1]) * UNIT_MS[m[2].toLowerCase()];
  return Math.round(total);
}

/** ms → `45s` | `12m` | `1h05m` | `2d3h`. */
export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms) || ms < 0) return "-";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h${String(m % 60).padStart(2, "0")}m`;
  return `${Math.floor(h / 24)}d${h % 24}h`;
}

export type Budget = "under" | "near" | "over" | "none";

/** Actual vs estimate: under ≤ plan, near ≤ +25 %, over beyond. none when no estimate. */
export function budgetState(estimate: number | null, actual: number | null): Budget {
  if (estimate === null || actual === null || estimate <= 0) return "none";
  if (actual <= estimate) return "under";
  return actual <= estimate * 1.25 ? "near" : "over";
}

/** Signed percent vs estimate, e.g. `+20%` / `-60%`; `-` without both numbers. */
export function variancePct(estimate: number | null, actual: number | null): string {
  if (estimate === null || actual === null || estimate <= 0) return "-";
  const pct = Math.round(((actual - estimate) / estimate) * 100);
  return `${pct > 0 ? "+" : ""}${pct}%`;
}
