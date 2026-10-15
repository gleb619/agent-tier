import { closeSync, fstatSync, openSync, readSync } from "node:fs";

/** Token usage of one run. `reported` = parsed from agent output, `estimated` = chars/4 heuristic. */
export interface RunUsage {
  tokensIn: number;
  tokensOut: number;
  source: "reported" | "estimated";
}

/** Logs larger than this are read from the tail; usage lines are emitted at/near the end. */
export const MAX_LOG_BYTES = 8 * 1024 * 1024;
const CHARS_PER_TOKEN = 4;

type Rec = Record<string, unknown>;

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0;
}

/** Pull in/out token counts out of the usage-shaped objects the supported agents emit. */
function readCounts(o: unknown): { in: number; out: number } | null {
  if (!o || typeof o !== "object") return null;
  const r = o as Rec;
  const tin = num(r.inputTokens) || num(r.input_tokens) || num(r.prompt_tokens) || num(r.promptTokens) || num(r.input);
  const tout =
    num(r.outputTokens) || num(r.output_tokens) || num(r.completion_tokens) || num(r.completionTokens) || num(r.output);
  return tin + tout > 0 ? { in: tin, out: tout } : null;
}

function findUsage(o: unknown, depth = 0): { in: number; out: number } | null {
  if (!o || typeof o !== "object" || depth > 4) return null;
  const r = o as Rec;
  for (const key of ["usage", "tokens"]) {
    const hit = readCounts(r[key]);
    if (hit) return hit;
  }
  for (const v of Object.values(r)) {
    if (v && typeof v === "object") {
      const hit = findUsage(v, depth + 1);
      if (hit) return hit;
    }
  }
  return null;
}

function isStepRecord(o: Rec): boolean {
  const t = String((o.type as string | undefined) ?? "");
  const part = o.part as Rec | undefined;
  return /step[-_]finish/i.test(t) || /step[-_]finish/i.test(String(part?.type ?? ""));
}

/**
 * Parse reported usage from an agent log (JSONL-ish: non-JSON lines are skipped).
 * Per-step records (opencode `step-finish`) are summed; otherwise usage objects are
 * cumulative run totals, so the last one wins. null when the agent reported nothing.
 */
export function parseReportedUsage(log: string): { tokensIn: number; tokensOut: number } | null {
  let stepIn = 0;
  let stepOut = 0;
  let steps = 0;
  let last: { in: number; out: number } | null = null;

  for (const line of log.split("\n")) {
    const text = line.trim();
    if (!text.startsWith("{") || !/token|usage/i.test(text)) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      continue;
    }
    const hit = findUsage(parsed);
    if (!hit) continue;
    if (isStepRecord(parsed as Rec)) {
      stepIn += hit.in;
      stepOut += hit.out;
      steps += 1;
    } else {
      last = hit;
    }
  }
  if (steps > 0) return { tokensIn: stepIn, tokensOut: stepOut };
  return last ? { tokensIn: last.in, tokensOut: last.out } : null;
}

/** chars/4 over prompt (input) and log (output). */
export function estimateUsage(prompt: string, log: string): RunUsage {
  return {
    tokensIn: Math.ceil(prompt.length / CHARS_PER_TOKEN),
    tokensOut: Math.ceil(log.length / CHARS_PER_TOKEN),
    source: "estimated",
  };
}

export function computeUsage(prompt: string, log: string): RunUsage {
  const reported = parseReportedUsage(log);
  return reported ? { ...reported, source: "reported" } : estimateUsage(prompt, log);
}

/** Best-effort bounded read of a log file's tail; "" when unreadable. */
export function readLogTail(file: string, maxBytes = MAX_LOG_BYTES): string {
  let fd: number | undefined;
  try {
    fd = openSync(file, "r");
    const size = fstatSync(fd).size;
    const len = Math.min(size, maxBytes);
    const buf = Buffer.alloc(len);
    readSync(fd, buf, 0, len, size - len);
    return buf.toString("utf8");
  } catch {
    return "";
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/** Usage for a finished run from its prompt + log file; never throws. */
export function usageForRun(prompt: string, logFile: string): RunUsage {
  return computeUsage(prompt ?? "", readLogTail(logFile));
}
