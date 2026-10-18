// Shared with the TUI/CLI: pure model + unit formatters (no fs), so both UIs agree on every number.

export { runUsageLines, type TaskBudget, type UsageLine, type UsageSummary } from "../../usage/model";
export { type Budget, budgetState, formatDuration, variancePct } from "../../usage/units";

import type { UsageSummary } from "../../usage/model";
import { formatDuration } from "../../usage/units";

/** Budget state → tailwind text colour class (neutral when nothing to compare). */
export const BUDGET_CLASS: Record<string, string> = {
  under: "text-success-dark",
  near: "text-yellow-600",
  over: "text-error-dark",
  none: "text-gray-900",
};

const pct = (r: number | null): string => (r === null ? "—" : `${Math.round(r * 100)}%`);

export interface UsageTile {
  label: string;
  value: string;
  hint?: string;
  tone: "none" | "under" | "near" | "over";
}

/** Dashboard tiles: consumed time, then planned-vs-consumed health. Pure. */
export function deriveUsageTiles(u: UsageSummary): UsageTile[] {
  const ratioTone = (r: number | null): UsageTile["tone"] =>
    r === null ? "none" : r <= 1 ? "under" : r <= 1.25 ? "near" : "over";
  return [
    { label: "Time consumed", value: formatDuration(u.ms), hint: `${u.runs} finished runs`, tone: "none" },
    {
      label: "Time vs plan",
      value: pct(u.timeRatio),
      hint: `${u.tasksMetered} tasks metered`,
      tone: ratioTone(u.timeRatio),
    },
    {
      label: "Over budget",
      value: String(u.tasksOverBudget),
      hint: `of ${u.tasksWithEstimate} with estimate`,
      tone: u.tasksOverBudget > 0 ? "over" : "none",
    },
  ];
}
