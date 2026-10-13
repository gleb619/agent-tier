import { promises as fs } from "fs";
import type { ComposePhase } from "./state";

/** One unit of work supplied to compose by a task source (e.g. a kanban board row). */
export interface ComposeTask {
  id: string;
  title: string;
  description: string;
  /** Optional human/LLM-written plan to seed the compose run. */
  planFile?: string;
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
