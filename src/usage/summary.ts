import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { loadBoard, resolveBoardFile, toTasks } from "../kanban/board";
import { findPlanFile, parsePlanTime, setPlanTimeField } from "../kanban/plan-time";
import { DONE, type Task } from "../kanban/types";
import { calibrationFactor, estimateMs, toDurationText } from "./estimate";
import { buildTaskBudgets, type PlanTimes, type TaskBudget } from "./model";
import { aggregateTaskMetrics, loadTaskMetrics } from "./task-metrics";
import { parseDuration } from "./units";

export * from "./model";

function planFor(task: Task, boardFile: string): string | null {
  const boardDir = path.dirname(boardFile);
  return findPlanFile(task["Plan File"] ?? "", task.ID, path.dirname(boardDir), boardDir);
}

function readTimes(tasks: Task[], boardFile: string): Map<string, PlanTimes> {
  const out = new Map<string, PlanTimes>();
  for (const t of tasks) {
    const abs = planFor(t, boardFile);
    if (!abs) continue;
    const time = parsePlanTime(readFileSync(abs, "utf8"));
    out.set(t.ID, { plannedMs: parseDuration(time.planned), estMs: parseDuration(time.estimated) });
  }
  return out;
}

/**
 * I/O wrapper: board (`AT_KANBAN_FILE` / project docs/kanban.md) joined with the plan files' Time
 * sections and task metrics from every state dir. Never throws — a missing board, plan or metrics
 * file just yields no budgets.
 */
export function loadTaskBudgets(stateDirs: string[], boardFile?: string): TaskBudget[] {
  try {
    const file = resolveBoardFile(boardFile);
    if (!existsSync(file)) return [];
    const tasks = toTasks(loadBoard(file));
    const rows = stateDirs.flatMap((d) => loadTaskMetrics(d));
    return buildTaskBudgets(tasks, aggregateTaskMetrics(rows), readTimes(tasks, file));
  } catch {
    return [];
  }
}

export interface EstimateResult {
  taskId: string;
  plannedMs: number | null;
  estMs: number | null;
  /** Calibration factor applied (1 = plan taken as is). */
  factor: number;
  /** What happened to the plan file. */
  outcome: "written" | "unchanged" | "no-plan-file" | "no-planned";
}

/**
 * Compute `Estimated` = `Planned` × calibration (median actual/planned of Done tasks that have
 * metrics) and write it into each target plan's Time section. `ids` omitted = every non-Done task.
 * The agent's `Planned` is never touched.
 */
export function estimateTasks(stateDirs: string[], boardFile?: string, ids?: string[]): EstimateResult[] {
  const file = resolveBoardFile(boardFile);
  const tasks = toTasks(loadBoard(file));
  const totals = aggregateTaskMetrics(stateDirs.flatMap((d) => loadTaskMetrics(d)));

  const samples = tasks
    .filter((t) => t.Status === DONE && !ids?.includes(t.ID))
    .flatMap((t) => {
      const abs = planFor(t, file);
      const plannedMs = abs ? parseDuration(parsePlanTime(readFileSync(abs, "utf8")).planned) : null;
      const actualMs = totals.get(t.ID)?.ms ?? 0;
      return plannedMs ? [{ plannedMs, actualMs }] : [];
    });
  const factor = calibrationFactor(samples);

  const targets = ids ? tasks.filter((t) => ids.includes(t.ID)) : tasks.filter((t) => t.Status !== DONE);
  return targets.map((t): EstimateResult => {
    const base = { taskId: t.ID, plannedMs: null, estMs: null, factor };
    const abs = planFor(t, file);
    if (!abs) return { ...base, outcome: "no-plan-file" };
    const text = readFileSync(abs, "utf8");
    const plannedMs = parseDuration(parsePlanTime(text).planned);
    if (!plannedMs) return { ...base, outcome: "no-planned" };
    const est = estimateMs(plannedMs, factor);
    const next = setPlanTimeField(text, "Estimated", toDurationText(est));
    if (next === text) return { ...base, plannedMs, estMs: est, outcome: "unchanged" };
    writeFileSync(abs, next, "utf8");
    return { ...base, plannedMs, estMs: est, outcome: "written" };
  });
}
