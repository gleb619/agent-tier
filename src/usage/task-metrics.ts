import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { withLock } from "../lock";
import { loadRuns } from "../run-store";
import { type RunUsage, usageForRun } from "./extract";

/**
 * Durable per-task actuals. `runs.jsonl` is pruned (24h / 30 runs), so each finished
 * task run is copied here — append-only, one row per (taskId, runId).
 */
export interface TaskMetric {
  taskId: string;
  runId: string;
  agent: string;
  ms: number;
  tokensIn: number;
  tokensOut: number;
  source: RunUsage["source"];
  ts: string;
}

export interface TaskTotals {
  taskId: string;
  runs: number;
  ms: number;
  tokensIn: number;
  tokensOut: number;
  tokens: number;
  /** True when any contributing run used the chars/4 estimate. */
  estimated: boolean;
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
      tokensIn: 0,
      tokensOut: 0,
      tokens: 0,
      estimated: false,
    };
    t.runs += 1;
    t.ms += r.ms;
    t.tokensIn += r.tokensIn;
    t.tokensOut += r.tokensOut;
    t.tokens = t.tokensIn + t.tokensOut;
    t.estimated ||= r.source === "estimated";
    out.set(r.taskId, t);
  }
  return out;
}

/** Copy one finished run's time + usage into the durable task metrics. No-op when the run is unknown. */
export async function recordRunForTask(stateDir: string, runId: string, taskId: string): Promise<void> {
  const rec = loadRuns(stateDir).find((r) => r.runId === runId);
  if (!rec) return;
  const usage = rec.usage ?? usageForRun(rec.prompt, rec.logFile);
  const start = new Date(rec.startedAt).getTime();
  const end = rec.finishedAt ? new Date(rec.finishedAt).getTime() : Date.now();
  await recordTaskMetric(stateDir, {
    taskId,
    runId,
    agent: rec.agent,
    ms: Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, end - start) : 0,
    tokensIn: usage.tokensIn,
    tokensOut: usage.tokensOut,
    source: usage.source,
    ts: new Date().toISOString(),
  });
}
