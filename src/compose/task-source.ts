import { promises as fs } from "node:fs";
import type { ComposePhase } from "./state";

/** One unit of work supplied to compose by a task source (e.g. a kanban board row). */
export interface ComposeTask {
  id: string;
  title: string;
  description: string;
  /** Optional human/LLM-written plan to seed the compose run. */
  planFile?: string;
  /** Plan-file keywords/labels: seed the codegraph query in INVESTIGATE instead of the whole goal text. */
  keywords?: string[];
}

export interface TaskFinishInfo {
  goalDir: string;
  round: number;
}

/**
 * Plugs an external task queue into compose. `claim` picks the next task (null
 * when the queue is drained). Hooks are best-effort: the machine catches and
 * logs their errors, they never abort a run.
 */
export interface TaskSource {
  claim(): Promise<ComposeTask | null>;
  onPhase?(task: ComposeTask, phase: ComposePhase, round: number): Promise<void>;
  onFinish(task: ComposeTask, outcome: "DONE" | "FAILED", info: TaskFinishInfo): Promise<void>;
}

/** Goal text for a task: title + description (+ plan file content when it resolves). */
export async function taskGoal(task: ComposeTask): Promise<string> {
  let goal = task.title;
  if (task.description) goal += `\n\n${task.description}`;
  if (task.planFile) {
    try {
      const plan = (await fs.readFile(task.planFile, "utf8")).trim();
      if (plan) goal += `\n\n## Existing plan\n\n${plan}`;
    } catch {
      // Plan file is a hint only — a missing/unreadable one must not block the run.
    }
  }
  return goal;
}

const KEYWORD_KEYS = new Set(["keywords", "labels", "tags"]);
const KEYWORD_SCAN_LINES = 30;
const MAX_KEYWORDS = 12;

/**
 * Keywords/labels from a plan file's head: a `keywords:` / `labels:` / `tags:` line
 * (YAML front matter or a plain `Keywords: a, b` line), comma-separated, optional `[...]`.
 */
export function parsePlanKeywords(plan: string): string[] {
  for (const line of plan.split("\n").slice(0, KEYWORD_SCAN_LINES)) {
    const m = /^\s*(?:[-*]\s+)?(?:\*\*)?([A-Za-z]+)(?:\*\*)?\s*:\s*(?:\*\*)?\s*(.+?)\s*$/.exec(line);
    if (!m || !KEYWORD_KEYS.has(m[1].toLowerCase())) continue;
    const words = m[2]
      .replace(/^\[|\]$/g, "")
      .split(",")
      .map((w) => w.replace(/[`"']/g, "").trim())
      .filter((w) => w.length > 0);
    return [...new Set(words)].slice(0, MAX_KEYWORDS);
  }
  return [];
}

/** Keywords of the task's plan file; empty when unset, unreadable or absent (hint only). */
export async function taskKeywords(task: ComposeTask): Promise<string[]> {
  if (task.keywords?.length) return task.keywords;
  if (!task.planFile) return [];
  try {
    return parsePlanKeywords(await fs.readFile(task.planFile, "utf8"));
  } catch {
    return [];
  }
}
