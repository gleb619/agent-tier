export const COLUMNS = [
  "ID",
  "Status",
  "Title",
  "Description",
  "Priority",
  "Owner",
  "Blocks",
  "Blocked By",
  "Plan File",
] as const;

export type Column = (typeof COLUMNS)[number];

/** Estimate columns: appended by `at kanban add --est-*` on boards that predate them. */
export const COL_EST_TIME = "Est Time";
export const COL_EST_TOKENS = "Est Tokens";
export const ESTIMATE_COLUMNS = [COL_EST_TIME, COL_EST_TOKENS] as const;

export interface Task {
  [key: string]: string;
}

export const PRIORITY_ORDER: Record<string, number> = { High: 0, Medium: 1, Low: 2 };
export const UNKNOWN_PRIORITY = 999;
export const VALID_PRIORITIES = ["High", "Medium", "Low"];

export const SENTINEL = "-";
export const DEFAULT_STATUS = "Backlog";
export const IN_PROGRESS = "In Progress";
export const BLOCKED = "Blocked";
export const DONE = "Done";
export const FALLBACK_STATUSES = ["Backlog", "In Progress", "Blocked", "Done"];

export const MAX_DESC = 128;
export const DESC_SUFFIX = "...";

export const REWRITE_TRAILER = "[kanban-rewrite]";
export const DEFAULT_BOARD_REL = "docs/kanban.md";
export const PLANS_DIR_REL = "docs/plans";
export const ID_PATTERN = /^T\d+$/;

export const DEFAULT_OWNER = "loop";
export const DEFAULT_PRIORITY = "Low";
export const DEFAULT_TITLE = "New task";

export function blank(value: string | undefined | null): boolean {
  if (value === undefined || value === null) return true;
  const trimmed = value.trim();
  return trimmed === "" || trimmed === SENTINEL;
}

/** `T<integer>` is load-bearing: it enables max+1 generation and numeric (not lexicographic) sort. */
export function numericId(id: string): number {
  const m = /^T(\d+)$/i.exec(String(id).trim());
  return m ? Number(m[1]) : 0;
}
