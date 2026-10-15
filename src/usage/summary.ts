import { existsSync } from "node:fs";
import { loadBoard, resolveBoardFile, toTasks } from "../kanban/board";
import { buildTaskBudgets, type TaskBudget } from "./model";
import { aggregateTaskMetrics, loadTaskMetrics } from "./task-metrics";

export * from "./model";

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
