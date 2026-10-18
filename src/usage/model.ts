/** Pure planned-vs-consumed model: no fs, safe to bundle into the WebUI. I/O lives in ./summary. */
import type { Task } from "../kanban/types";
import { type Budget, budgetState, formatDuration, variancePct } from "./units";

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

/** A task plan's Time section, as durations (see src/kanban/plan-time.ts). */
export interface PlanTimes {
  /** Written by the planning agent. */
  plannedMs: number | null;
  /** Written by `at` from history. */
  estMs: number | null;
}

/** Planned (agent) and estimated (`at`) vs consumed wall time for one kanban task. */
export interface TaskBudget {
  taskId: string;
  title: string;
  status: string;
  plannedMs: number | null;
  estMs: number | null;
  actualMs: number;
  runs: number;
  timeState: Budget;
}

export function buildTaskBudgets(
  tasks: Task[],
  totals: Map<string, TaskTotals>,
  times: Map<string, PlanTimes> = new Map(),
): TaskBudget[] {
  return tasks.map((t) => {
    const tot = totals.get(t.ID);
    const { plannedMs = null, estMs = null } = times.get(t.ID) ?? {};
    const actualMs = tot?.ms ?? 0;
    const metered = (tot?.runs ?? 0) > 0;
    return {
      taskId: t.ID,
      title: t.Title ?? "",
      status: t.Status ?? "",
      plannedMs,
      estMs,
      actualMs,
      runs: tot?.runs ?? 0,
      timeState: metered ? budgetState(plannedMs, actualMs) : "none",
    };
  });
}

export interface UsageSummary {
  /** Runs counted (finished ones). */
  runs: number;
  ms: number;
  /** Tasks with at least one metered run. */
  tasksMetered: number;
  /** Metered tasks whose plan carries a Planned time. */
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
  const timed = metered.filter((b) => b.plannedMs !== null && b.plannedMs > 0);
  const planned = timed.reduce((s, b) => s + (b.plannedMs ?? 0), 0);

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
      value: `${formatDuration(budget.actualMs)} / ${budget.plannedMs === null ? "no plan" : `planned ${formatDuration(budget.plannedMs)} (${variancePct(budget.plannedMs, budget.actualMs)})`}${budget.estMs === null ? "" : ` · est ${formatDuration(budget.estMs)}`}${retries}`,
      state: budget.timeState,
    });
  }
  return lines;
}
