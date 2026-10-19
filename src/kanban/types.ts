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

/** Plan-file sections. Time lives in the plan (Planned: by the agent, Estimated: by `at`), not in the board. */
export const KEYWORDS_HEADING = "## Keywords";
export const TIME_HEADING = "## Time";

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
export const BACKLOG = "Backlog";
export const DONE = "Done";
/** Built-in statuses: always valid, whatever the legend declares. The legend only adds to them. */
export const CORE_STATUSES = ["Backlog", "In Progress", "Blocked", "Done"];
export const FALLBACK_STATUSES = CORE_STATUSES;

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
