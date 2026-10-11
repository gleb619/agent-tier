import type { RunRecord } from "../../../run-store";
import { UNNAMED_PLACEHOLDER } from "../../../run-store";
import { dateBucket } from "../../format";
import type { ActiveView } from "../../store/ui";

/**
 * Flat row model for the sidebar. The sidebar renders one vertical list where
 * every row carries `{ icon, label, hint }` so the filter entry, the four
 * menu rows, the separator, the date-bucket group headers, and the runs share
 * the same render path.
 *
 * `separator` and `group-header` rows are visual only — selection skips them.
 */

export type RowKind = "filter" | "menu" | "separator" | "group-header" | "run";

export interface FilterRow {
  kind: "filter";
  label: string;
  filter: string;
}

export interface MenuRow {
  kind: "menu";
  view: ActiveView;
  key: string;
  label: string;
  active: boolean;
}

export interface SeparatorRow {
  kind: "separator";
}

export interface GroupHeaderRow {
  kind: "group-header";
  label: string;
}

export interface RunRow {
  kind: "run";
  runId: string;
  run: RunRecord;
}

export type Row = FilterRow | MenuRow | SeparatorRow | GroupHeaderRow | RunRow;

/** Numeric hotkeys per design doc §11.6 — single source of truth for the menu. */
export const SIDEBAR_MENU_ITEMS: ReadonlyArray<Omit<MenuRow, "active">> = [
  { kind: "menu", view: "dashboard", key: "1", label: "Dashboard" },
  { kind: "menu", view: "new-task", key: "2", label: "New Task" },
  { kind: "menu", view: "run-details", key: "3", label: "Run Details" },
  { kind: "menu", view: "settings", key: "4", label: "Settings" },
];

/**
 * Per-view keyword/keyword aliases for the sidebar filter. The filter matches
 * a menu item when the query is a substring of the item's label OR of any of
 * its keywords. Lower-cased before comparison.
 */
export const MENU_KEYWORDS: Record<ActiveView, readonly string[]> = {
  dashboard: ["runs", "history", "status", "overview", "dashboard"],
  "new-task": ["task", "new", "prompt", "run", "create", "submit"],
  "run-details": ["log", "detail", "output", "run", "prompt", "meta"],
  settings: ["config", "setting", "retry", "retries", "sandbox", "timeout", "line", "tier"],
};

/** All label/keyword strings for a menu item, lower-cased. */
function menuSearchCorpus(item: Omit<MenuRow, "active">): string[] {
  return [item.label.toLowerCase(), ...MENU_KEYWORDS[item.view].map((k) => k.toLowerCase())];
}

/**
 * Does `query` match this menu item? Empty/whitespace → matches all. A single
 * token must hit the corpus somewhere; multi-token queries (split on
 * whitespace) must hit everywhere (AND across tokens).
 */
export function menuMatchesQuery(item: Omit<MenuRow, "active">, query: string): boolean {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return true;
  const tokens = trimmed.split(/\s+/);
  const corpus = menuSearchCorpus(item);
  return tokens.every((t) => corpus.some((entry) => entry.includes(t)));
}

export interface RunGroup {
  label: string;
  runs: RunRecord[];
}

/**
 * Bucket an already-ordered run list by day, keeping the input order. The
 * sidebar re-exports this for callers that group runs before building the row
 * model (e.g. legacy tests).
 */
export function groupRunsByDate(runs: RunRecord[]): RunGroup[] {
  const groups: RunGroup[] = [];
  for (const run of runs) {
    const label = dateBucket(run.startedAt);
    const last = groups[groups.length - 1];
    if (last && last.label === label) {
      last.runs.push(run);
    } else {
      groups.push({ label, runs: [run] });
    }
  }
  return groups;
}

/** Namer output when it resolved, otherwise the run id. */
export function runLabel(run: RunRecord): string {
  return run.name === UNNAMED_PLACEHOLDER ? run.runId : run.name;
}

export interface RowModelInput {
  /** Already grouped runs in display order; produced by `groupRunsByDate`. */
  groups: RunGroup[];
  /** Current sidebar filter — surfaced on the filter row. */
  filter: string;
  /** Active view — only the matching menu row gets the `▶` marker. */
  activeView: ActiveView;
}

/**
 * Build the flat row list in display order:
 * filter → separator → 4 menu → separator → group-header + runs (per group).
 *
 * Two visual separators: one between the filter and the menu so the filter
 * input never touches the first menu row, and one between the menu and the
 * run list so the two zones read as distinct blocks.
 *
 * The sidebar filter also narrows the menu rows: non-matching items are
 * hidden so the input behaves as a unified context filter. The filter row
 * itself always renders, and the row model stays valid (selectable indices
 * always include at least the filter row) even when every menu row is hidden.
 */
export function buildRowModel(input: RowModelInput): Row[] {
  const rows: Row[] = [];
  rows.push({ kind: "filter", label: "Filter runs…", filter: input.filter });
  rows.push({ kind: "separator" });
  for (const item of SIDEBAR_MENU_ITEMS) {
    if (!menuMatchesQuery(item, input.filter)) continue;
    rows.push({
      kind: "menu",
      view: item.view,
      key: item.key,
      label: item.label,
      active: input.activeView === item.view,
    });
  }
  rows.push({ kind: "separator" });
  for (const group of input.groups) {
    rows.push({ kind: "group-header", label: group.label });
    for (const run of group.runs) {
      rows.push({ kind: "run", runId: run.runId, run });
    }
  }
  return rows;
}

/** Indices of rows that participate in j/k navigation. */
export function selectableRowIndices(rows: Row[]): number[] {
  const out: number[] = [];
  rows.forEach((row, i) => {
    if (row.kind === "filter" || row.kind === "menu" || row.kind === "run") out.push(i);
  });
  return out;
}

/** Type guard for selectable rows. */
export function isSelectable(row: Row): row is FilterRow | MenuRow | RunRow {
  return row.kind === "filter" || row.kind === "menu" || row.kind === "run";
}

/**
 * Move the cursor by `delta` within the selectable subset, clamping to the
 * ends. Visual-only rows (separator, group-header) are skipped automatically.
 *
 * Returns the row index for `current` to land on, or `-1` when nothing is
 * selectable.
 */
export function moveSelection(rows: Row[], current: number, delta: 1 | -1): number {
  const sel = selectableRowIndices(rows);
  if (sel.length === 0) return -1;
  if (current < 0) return sel[delta === 1 ? 0 : sel.length - 1];
  const cursor = sel.indexOf(current);
  if (cursor === -1) return sel[0];
  const next = Math.max(0, Math.min(sel.length - 1, cursor + delta));
  return sel[next];
}

/**
 * Map a cursor onto a rebuilt row list so a refresh never yanks the
 * selection somewhere else. New runs land at the top of the list and old runs
 * get pruned, so a raw index would silently slide onto a neighbour:
 *  - cursor on a run row  → follow that run id when it still exists
 *  - cursor on filter/menu → keep the index while it stays selectable
 *  - cursor gone (-1)      → land on the first selectable row
 *  - nothing selectable    → -1
 * Unchanged input must return the input index untouched, so an effect that
 * writes only on difference stays silent across no-op polls.
 */
export function preserveSidebarIndex(oldRows: Row[], oldIndex: number, newRows: Row[]): number {
  const sel = selectableRowIndices(newRows);
  if (sel.length === 0) return -1;

  const old = oldIndex >= 0 ? oldRows[oldIndex] : undefined;
  if (old && old.kind === "run") {
    const kept = newRows.findIndex((r) => r.kind === "run" && r.runId === old.runId);
    if (kept !== -1) return kept;
  } else if (oldIndex >= 0 && sel.includes(oldIndex)) {
    return oldIndex;
  }
  return sel[0];
}
