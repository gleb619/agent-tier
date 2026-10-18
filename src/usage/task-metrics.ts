import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { withLock } from "../lock";
import { loadRuns, updateRun } from "../run-store";
import type { TaskTotals } from "./model";

export type { TaskTotals } from "./model";

/**
 * Durable per-task actuals. `runs.jsonl` is pruned (24h / 30 runs), so each finished
 * task run is copied here — append-only, one row per (taskId, runId).
 */
export interface TaskMetric {
  taskId: string;
  runId: string;
  agent: string;
  ms: number;
  ts: string;
}

const MAX_ROWS = 5000;

export function getTaskMetricsFile(stateDir: string): string {
  return path.join(stateDir, "task-metrics.jsonl");
}

export function loadTaskMetrics(stateDir: string): TaskMetric[] {
  try {
    return readFileSync(getTaskMetricsFile(stateDir), "utf8")
      .split("\n")
      .filter((l) => l.trim())
      .flatMap((l) => {
        try {
          return [JSON.parse(l) as TaskMetric];
        } catch {
          return [];
        }
      });
  } catch {
    return [];
  }
}

/** Idempotent per (taskId, runId): a compose resume re-recording the same run replaces its row. */
export async function recordTaskMetric(stateDir: string, metric: TaskMetric): Promise<void> {
  const file = getTaskMetricsFile(stateDir);
  mkdirSync(path.dirname(file), { recursive: true });
  await withLock(file, () => {
    const rows = loadTaskMetrics(stateDir);
    const idx = rows.findIndex((r) => r.taskId === metric.taskId && r.runId === metric.runId);
    if (idx === -1 && rows.length < MAX_ROWS) {
      appendFileSync(file, `${JSON.stringify(metric)}\n`, "utf8");
      return;
    }
    if (idx === -1) rows.splice(0, rows.length - MAX_ROWS + 1);
    else rows.splice(idx, 1);
    rows.push(metric);
    writeFileSync(file, `${rows.map((r) => JSON.stringify(r)).join("\n")}\n`, "utf8");
  });
}

/** Per-task sums over every recorded run (retries included). */
export function aggregateTaskMetrics(rows: TaskMetric[]): Map<string, TaskTotals> {
  const out = new Map<string, TaskTotals>();
  for (const r of rows) {
    const t = out.get(r.taskId) ?? {
      taskId: r.taskId,
      runs: 0,
      ms: 0,
    };
    t.runs += 1;
    t.ms += r.ms;
    out.set(r.taskId, t);
  }
  return out;
}

/** Copy one finished run's time into the durable task metrics. No-op when the run is unknown. */
export async function recordRunForTask(stateDir: string, runId: string, taskId: string): Promise<void> {
  const rec = loadRuns(stateDir).find((r) => r.runId === runId);
  if (!rec) return;
  // Link the run to its task so Run Details can show planned-vs-consumed (also survives in runs.jsonl).
  if (rec.taskId !== taskId) await updateRun(stateDir, runId, { taskId });
  const start = new Date(rec.startedAt).getTime();
  const end = rec.finishedAt ? new Date(rec.finishedAt).getTime() : Date.now();
  await recordTaskMetric(stateDir, {
    taskId,
    runId,
    agent: rec.agent,
    ms: Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, end - start) : 0,
    ts: new Date().toISOString(),
  });
}
