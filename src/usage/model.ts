/** Pure planned-vs-consumed model: no fs, safe to bundle into the WebUI. I/O lives in ./summary. */
import { COL_EST_TIME, type Task } from "../kanban/types";
import { type Budget, budgetState, formatDuration, parseDuration, variancePct } from "./units";

/** Minimal run shape the model reads — `RunLike` and the WebUI's `ApiRun` both satisfy it. */
export interface RunLike {
  startedAt: string;
  finishedAt: string | null;
  status: string;
}

/** Per-task sums over every recorded run (retries included). */
export interface TaskTotals {
  taskId: string;
  runs: number;
  ms: number;
}

/** Planned vs consumed wall time for one kanban task. */
export interface TaskBudget {
  taskId: string;
  title: string;
  status: string;
  estMs: number | null;
  actualMs: number;
  runs: number;
  timeState: Budget;
}

export function buildTaskBudgets(tasks: Task[], totals: Map<string, TaskTotals>): TaskBudget[] {
  return tasks.map((t) => {
    const tot = totals.get(t.ID);
    const estMs = parseDuration(t[COL_EST_TIME]);
    const actualMs = tot?.ms ?? 0;
    const metered = (tot?.runs ?? 0) > 0;
    return {
      taskId: t.ID,
      title: t.Title ?? "",
      status: t.Status ?? "",
      estMs,
      actualMs,
      runs: tot?.runs ?? 0,
      timeState: metered ? budgetState(estMs, actualMs) : "none",
    };
  });
}

export interface UsageSummary {
  /** Runs counted (finished ones). */
  runs: number;
  ms: number;
  /** Tasks with at least one metered run. */
  tasksMetered: number;
  /** Metered tasks that have a time estimate. */
  tasksWithEstimate: number;
  tasksOverBudget: number;
  /** Sum(actual)/Sum(estimate) over metered tasks having an estimate; null when none. */
  timeRatio: number | null;
}

function runMs(r: RunLike): number {
  const start = new Date(r.startedAt).getTime();
  const end = r.finishedAt ? new Date(r.finishedAt).getTime() : Date.now();
  return Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, end - start) : 0;
}

/** Dashboard numbers: time over the given runs + budget health over the board. Pure. */
export function summarizeUsage(runs: RunLike[], budgets: TaskBudget[]): UsageSummary {
  const finished = runs.filter((r) => r.status !== "running");
  const ms = finished.reduce((s, r) => s + runMs(r), 0);

  const metered = budgets.filter((b) => b.runs > 0);
  const timed = metered.filter((b) => b.estMs !== null && b.estMs > 0);
  const planned = timed.reduce((s, b) => s + (b.estMs ?? 0), 0);

  return {
    runs: finished.length,
    ms,
    tasksMetered: metered.length,
    tasksWithEstimate: timed.length,
    tasksOverBudget: metered.filter((b) => b.timeState === "over").length,
    timeRatio: planned > 0 ? timed.reduce((s, b) => s + b.actualMs, 0) / planned : null,
  };
}

export interface UsageLine {
  label: string;
  value: string;
  state: Budget;
}

/**
 * Run Details rows: the run's own time, then (when the run belongs to a kanban task) the
 * task's consumed-vs-planned line — retries included, so it can exceed the run's.
 */
export function runUsageLines(run: RunLike, budget: TaskBudget | null): UsageLine[] {
  const lines: UsageLine[] = [{ label: "time", value: formatDuration(runMs(run)), state: "none" }];
  if (budget && budget.runs > 0) {
    const retries = budget.runs > 1 ? ` · ${budget.runs} runs` : "";
    lines.push({
      label: `${budget.taskId} time`,
      value: `${formatDuration(budget.actualMs)} / ${budget.estMs === null ? "no est" : `est ${formatDuration(budget.estMs)} (${variancePct(budget.estMs, budget.actualMs)})`}${retries}`,
      state: budget.timeState,
    });
  }
  return lines;
}
