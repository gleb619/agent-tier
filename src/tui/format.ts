import type { RunRecord } from "../run-store";

/** Shared palette for the TUI. Single source of truth. */
export const TUI_COLORS = {
  fg: "#c9d1d9",
  muted: "#8b949e",
  dim: "#6e7681",
  dimmer: "#484f58",
  accent: "#58a6ff",
  ok: "#3fb950",
  warn: "#d29922",
  error: "#f85149",
  border: "#555555",
} as const;

/** Column widths kept in one place so dashboard rows stay aligned. */
export const RUN_COL = {
  ID: 20,
  AGENT: 12,
  STATUS: 8,
} as const;

export function statusIcon(status: RunRecord["status"]): string {
  switch (status) {
    case "running":
      return "●";
    case "done":
      return "✓";
    case "failed":
      return "✗";
    case "stuck":
      return "⚠";
  }
}

export function statusColor(status: RunRecord["status"]): string {
  switch (status) {
    case "running":
      return "#3fb950";
    case "done":
      return "#388bfd";
    case "failed":
      return "#f85149";
    case "stuck":
      return "#d29922";
  }
}

/** Wall-clock run length in ms; running rounds report as long as they have been alive. */
export function durationMs(r: RunRecord): number {
  const start = new Date(r.startedAt).getTime();
  const end = r.finishedAt ? new Date(r.finishedAt).getTime() : Date.now();
  return Math.max(0, end - start);
}

/** "3m 05s" / "42s" — elapsed between startedAt and finishedAt (or now). */
export function formatDuration(r: RunRecord): string {
  const diff = Math.floor(durationMs(r) / 1000);
  const mins = Math.floor(diff / 60);
  const secs = diff % 60;
  if (mins > 0) {
    return `${mins}m ${String(secs).padStart(2, "0")}s`;
  }
  return `${secs}s`;
}

/** Human ms for aggregate stats ("1.2s", "4m 30s", "1h 02m"). */
export function formatMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ${String(secs % 60).padStart(2, "0")}s`;
  return `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, "0")}m`;
}

export function isToday(startedAt: string): boolean {
  const date = new Date(startedAt);
  const today = new Date();
  return (
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate()
  );
}

/** Compact "1:22:04 PM" clock for header/footer lines. */
export function formatClock(time: string | null): string {
  if (!time) return "-";
  return new Date(time).toLocaleTimeString();
}

/** Placeholder for an exit code the run never reported. */
export function formatExitCode(exitCode: number | null): string {
  return exitCode === null ? "-" : String(exitCode);
}

/** "10:00 AM → 10:01 AM", or "10:00 AM → running" while the run is alive. */
export function formatClockRange(startedAt: string, finishedAt: string | null): string {
  const start = formatClock(startedAt);
  return finishedAt ? `${start} → ${formatClock(finishedAt)}` : `${start} → running`;
}

export function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen - 1)}…`;
}

/**
 * Tabular row for a single run. Status column + exit-code column are opt-in so
 * the active-runs and recent-completions sections can share one formatter.
 * Pure helper — unit-tested without a renderer.
 */
export function formatRunRow(r: RunRecord, opts: { status?: boolean; exitCode?: boolean } = {}): string {
  const parts: string[] = [
    statusIcon(r.status),
    truncate(r.runId, RUN_COL.ID).padEnd(RUN_COL.ID),
    r.agent.padEnd(RUN_COL.AGENT),
  ];
  if (opts.status) parts.push(r.status.padEnd(RUN_COL.STATUS));
  if (opts.exitCode) parts.push(`code ${r.exitCode ?? "-"}`);
  parts.push(formatMs(durationMs(r)));
  return parts.join("  ");
}

/** Tabular row for an agent health entry. Deactivated agents get a trailing tag. */
export function formatAgentRow(a: { name: string; failures: number; deactivated: boolean }): string {
  const icon = a.deactivated ? "✗" : "✓";
  const suffix = a.deactivated ? "  (disabled)" : "";
  return `${icon} ${a.name.padEnd(RUN_COL.AGENT)} failures ${a.failures}${suffix}`;
}

/** Log-line tint. */
export function lineColor(line: string): string {
  if (/\[ERROR\]|\[FAIL\]|error|Error/.test(line)) return "#f85149";
  if (/\[WARN\]|warn|Warning/.test(line)) return "#d29922";
  if (/\[INFO\]|info/.test(line)) return "#8b949e";
  if (/\[DEBUG\]|debug/.test(line)) return "#484f58";
  if (/✓|success|done|complete/.test(line)) return "#3fb950";
  return "#c9d1d9";
}

/** Date bucket ("Today" / "Yesterday" / "12 Mar") for sidebar grouping. */
export function dateBucket(startedAt: string): string {
  const date = new Date(startedAt);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  const sameDay = (a: Date, b: Date): boolean =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

  if (sameDay(date, today)) return "Today";
  if (sameDay(date, yesterday)) return "Yesterday";

  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${date.getDate()} ${months[date.getMonth()]}`;
}
