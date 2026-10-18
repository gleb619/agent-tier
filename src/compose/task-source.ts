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
const SECTION_SCAN_LINES = 80;
const KEYWORDS_SECTION_RE = /^#{1,6}\s+(?:keywords|labels|tags)\s*$/i;

/** Words under a `## Keywords` heading: bullets and/or comma-separated lines, up to the next heading. */
function parseKeywordsSection(plan: string): string[] {
  const out: string[] = [];
  let inSection = false;
  for (const raw of plan.split("\n").slice(0, SECTION_SCAN_LINES)) {
    const line = raw.trim();
    if (/^#{1,6}\s/.test(line)) {
      if (inSection) break;
      inSection = KEYWORDS_SECTION_RE.test(line);
      continue;
    }
    if (!inSection || !line || /^<.*>$/.test(line)) continue;
    out.push(...line.replace(/^[-*]\s+/, "").split(","));
  }
  return out;
}

function cleanWords(words: string[]): string[] {
  const cleaned = words.map((w) => w.replace(/[`"']/g, "").trim()).filter((w) => w.length > 0);
  return [...new Set(cleaned)].slice(0, MAX_KEYWORDS);
}

/**
 * Keywords/labels from a plan file: a `keywords:` / `labels:` / `tags:` line in the head
 * (YAML front matter or a plain `Keywords: a, b` line), comma-separated, optional `[...]`;
 * else the bullets / comma lines under a `## Keywords` heading.
 */
export function parsePlanKeywords(plan: string): string[] {
  for (const line of plan.split("\n").slice(0, KEYWORD_SCAN_LINES)) {
    const m = /^\s*(?:[-*]\s+)?(?:\*\*)?([A-Za-z]+)(?:\*\*)?\s*:\s*(?:\*\*)?\s*(.+?)\s*$/.exec(line);
    if (!m || !KEYWORD_KEYS.has(m[1].toLowerCase())) continue;
    const words = cleanWords(m[2].replace(/^\[|\]$/g, "").split(","));
    if (words.length > 0) return words;
  }
  return cleanWords(parseKeywordsSection(plan));
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
