import { loadRuns } from "../run-store";
import { joinRuns } from "../status";
import { loadTaskBudgets, summarizeUsage } from "../usage/summary";
import type { BridgeResource } from "./types";
import { optionalString } from "./util";

/**
 * `bridge usage summary` — dashboard numbers (time/tokens consumed, kanban budget health)
 * plus per-task planned-vs-consumed rows. params: `{ board?: string }`. Read-only.
 */
export const usageResource: BridgeResource = {
  summary: (params, ctx) => {
    const runs = joinRuns(
      ctx.stateDirs,
      ctx.stateDirs.map((d) => loadRuns(d)),
    );
    const budgets = loadTaskBudgets(ctx.stateDirs, optionalString(params, "board"));
    return { summary: summarizeUsage(runs, budgets), budgets: budgets.filter((b) => b.runs > 0) };
  },
};
