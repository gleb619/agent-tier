import { CORE_STATUSES } from "./types";

export const LEGEND_HEADING = "## Status Legend";
const LEGEND_ROW_RE = /^\|\s*`([^`]+)`/;

/**
 * The legend table *is* the status schema: adding a status means editing the document,
 * not the code. Both the mutator and the lint read their vocabulary from here.
 */
export function parseLegend(text: string): string[] {
  const statuses: string[] = [];
  let inLegend = false;

  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (line.startsWith("## ")) {
      inLegend = line === LEGEND_HEADING;
      continue;
    }
    if (!inLegend) continue;
    const m = LEGEND_ROW_RE.exec(line);
    if (!m) continue;
    const status = m[1].trim();
    if (status && !statuses.includes(status)) statuses.push(status);
  }

  return statuses;
}

/**
 * Effective status vocabulary: the 4 core statuses (compose and `next` depend on them) first,
 * then any custom status the legend adds, in legend order. A legend can extend, never shrink, the core.
 */
export function resolveStatuses(legend: string[]): string[] {
  return [...CORE_STATUSES, ...legend.filter((s) => !CORE_STATUSES.includes(s))];
}
