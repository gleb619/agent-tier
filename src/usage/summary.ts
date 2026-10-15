import { existsSync } from "node:fs";
import { loadBoard, resolveBoardFile, toTasks } from "../kanban/board";
import { COL_EST_TIME, COL_EST_TOKENS, type Task } from "../kanban/types";
import type { RunRecord } from "../run-store";
import { aggregateTaskMetrics, loadTaskMetrics, type TaskTotals } from "./task-metrics";
import {
  type Budget,
  budgetState,
  formatDuration,
  formatTokens,
  parseDuration,
  parseTokens,
  variancePct,
} from "./units";

/** Planned vs consumed for one kanban task. */
export interface TaskBudget {
  taskId: string;
  title: string;
  status: string;
  estMs: number | null;
  estTokens: number | null;
  actualMs: number;
  actualTokens: number;
  runs: number;
  /** True when any contributing run's tokens were estimated (chars/4), not agent-reported. */
  estimated: boolean;
  timeState: Budget;
  tokenState: Budget;
}

export function buildTaskBudgets(tasks: Task[], totals: Map<string, TaskTotals>): TaskBudget[] {
  return tasks.map((t) => {
    const tot = totals.get(t.ID);
    const estMs = parseDuration(t[COL_EST_TIME]);
    const estTokens = parseTokens(t[COL_EST_TOKENS]);
    const actualMs = tot?.ms ?? 0;
    const actualTokens = tot?.tokens ?? 0;
    const metered = (tot?.runs ?? 0) > 0;
    return {
      taskId: t.ID,
      title: t.Title ?? "",
      status: t.Status ?? "",
      estMs,
      estTokens,
      actualMs,
      actualTokens,
      runs: tot?.runs ?? 0,
      estimated: tot?.estimated ?? false,
      timeState: metered ? budgetState(estMs, actualMs) : "none",
      tokenState: metered ? budgetState(estTokens, actualTokens) : "none",
    };
  });
}

/**
 * I/O wrapper: board (`AT_KANBAN_FILE` / project docs/kanban.md) joined with task metrics from
 * every state dir. Never throws — a missing board or metrics file just yields no budgets.
 */
export function loadTaskBudgets(stateDirs: string[], boardFile?: string): TaskBudget[] {
  try {
    const file = resolveBoardFile(boardFile);
    if (!existsSync(file)) return [];
    const rows = stateDirs.flatMap((d) => loadTaskMetrics(d));
    return buildTaskBudgets(toTasks(loadBoard(file)), aggregateTaskMetrics(rows));
  } catch {
    return [];
  }
}

export interface UsageSummary {
  /** Runs counted (those with usage or a finish time). */
  runs: number;
  ms: number;
  tokensIn: number;
  tokensOut: number;
  tokens: number;
  /** Runs whose token count is a chars/4 estimate. */
  estimatedRuns: number;
  /** Tasks with at least one metered run. */
  tasksMetered: number;
  /** Metered tasks that have an estimate (time or tokens). */
  tasksWithEstimate: number;
  tasksOverBudget: number;
  /** Sum(actual)/Sum(estimate) over metered tasks having an estimate; null when none. */
  timeRatio: number | null;
  tokenRatio: number | null;
}

function runMs(r: RunRecord): number {
  const start = new Date(r.startedAt).getTime();
  const end = r.finishedAt ? new Date(r.finishedAt).getTime() : Date.now();
  return Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, end - start) : 0;
}

/** Dashboard numbers: totals over the given runs + budget health over the board. Pure. */
export function summarizeUsage(runs: RunRecord[], budgets: TaskBudget[]): UsageSummary {
  const finished = runs.filter((r) => r.status !== "running");
  let tokensIn = 0;
  let tokensOut = 0;
  let ms = 0;
  let estimatedRuns = 0;
  for (const r of finished) {
    ms += runMs(r);
    tokensIn += r.usage?.tokensIn ?? 0;
    tokensOut += r.usage?.tokensOut ?? 0;
    if (r.usage?.source === "estimated") estimatedRuns += 1;
  }

  const metered = budgets.filter((b) => b.runs > 0);
  const timed = metered.filter((b) => b.estMs !== null && b.estMs > 0);
  const tokened = metered.filter((b) => b.estTokens !== null && b.estTokens > 0);
  const ratio = (num: number, den: number): number | null => (den > 0 ? num / den : null);

  return {
    runs: finished.length,
    ms,
    tokensIn,
    tokensOut,
    tokens: tokensIn + tokensOut,
    estimatedRuns,
    tasksMetered: metered.length,
    tasksWithEstimate: metered.filter((b) => b.estMs !== null || b.estTokens !== null).length,
    tasksOverBudget: metered.filter((b) => b.timeState === "over" || b.tokenState === "over").length,
    timeRatio: ratio(
      timed.reduce((s, b) => s + b.actualMs, 0),
      timed.reduce((s, b) => s + (b.estMs ?? 0), 0),
    ),
    tokenRatio: ratio(
      tokened.reduce((s, b) => s + b.actualTokens, 0),
      tokened.reduce((s, b) => s + (b.estTokens ?? 0), 0),
    ),
  };
}

export interface UsageLine {
  label: string;
  value: string;
  state: Budget;
}

/**
 * Run Details rows: the run's own time + tokens, then (when the run belongs to a kanban
 * task) the task's consumed-vs-planned lines — retries included, so they can exceed the run's.
 */
export function runUsageLines(run: RunRecord, budget: TaskBudget | null): UsageLine[] {
  const lines: UsageLine[] = [];
  lines.push({ label: "time", value: formatDuration(runMs(run)), state: "none" });
  if (run.usage) {
    const mark = run.usage.source === "estimated" ? " (est)" : "";
    lines.push({
      label: "tokens",
      value: `${formatTokens(run.usage.tokensIn)} in · ${formatTokens(run.usage.tokensOut)} out${mark}`,
      state: "none",
    });
  } else if (run.status === "running") {
    lines.push({ label: "tokens", value: "pending", state: "none" });
  }
  if (budget && budget.runs > 0) {
    const retries = budget.runs > 1 ? ` · ${budget.runs} runs` : "";
    lines.push({
      label: `${budget.taskId} time`,
      value: `${formatDuration(budget.actualMs)} / ${budget.estMs === null ? "no est" : `est ${formatDuration(budget.estMs)} (${variancePct(budget.estMs, budget.actualMs)})`}${retries}`,
      state: budget.timeState,
    });
    lines.push({
      label: `${budget.taskId} tokens`,
      value: `${formatTokens(budget.actualTokens)} / ${budget.estTokens === null ? "no est" : `est ${formatTokens(budget.estTokens)} (${variancePct(budget.estTokens, budget.actualTokens)})`}${budget.estimated ? " (est)" : ""}`,
      state: budget.tokenState,
    });
  }
  return lines;
}
