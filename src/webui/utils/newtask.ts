import type { CreateRunInput } from "$types/api";

export const MAX_PROMPT_CHARS = 4000;
export const MAX_RETRIES = 5;
export const RUN_MODES = ["stream", "block", "detached"] as const;
export type RunMode = (typeof RUN_MODES)[number];

export interface NewTaskForm {
  prompt: string;
  /** 1-4, or null for "Auto" (line-order scheduling). */
  tier: number | null;
  /** Agent name, or "" for "Auto" (round-robin within the tier). */
  agent: string;
  mode: string;
  retries: number;
}

export function isRunMode(value: unknown): value is RunMode {
  return typeof value === "string" && (RUN_MODES as readonly string[]).includes(value);
}

export function clampRetries(value: unknown): number {
  const n = typeof value === "number" ? Math.trunc(value) : Number.NaN;
  if (!Number.isFinite(n)) return 0;
  return Math.min(Math.max(n, 0), MAX_RETRIES);
}

/** Client-side mirror of the POST /api/runs validation; returns an error message or null. */
export function validateNewTask(form: NewTaskForm, knownAgents: string[] = []): string | null {
  if (form.prompt.trim().length === 0) return "Prompt is required.";
  if (form.prompt.length > MAX_PROMPT_CHARS) return `Prompt is too long (max ${MAX_PROMPT_CHARS} characters).`;
  if (form.tier !== null && (!Number.isInteger(form.tier) || form.tier < 1 || form.tier > 4)) {
    return "Tier must be 1, 2, 3 or 4.";
  }
  if (form.agent !== "" && knownAgents.length > 0 && !knownAgents.includes(form.agent)) {
    return `Unknown agent: ${form.agent}.`;
  }
  if (!isRunMode(form.mode)) return "Mode must be stream, block or detached.";
  if (!Number.isInteger(form.retries) || form.retries < 0 || form.retries > MAX_RETRIES) {
    return `Retries must be an integer between 0 and ${MAX_RETRIES}.`;
  }
  return null;
}

/** Build the POST /api/runs payload; "Auto" agent/tier are omitted. */
export function buildCreateRunInput(form: NewTaskForm): CreateRunInput {
  const input: CreateRunInput = { prompt: form.prompt.trim() };
  if (form.agent !== "") input.agent = form.agent;
  if (form.tier !== null) input.tier = form.tier;
  return input;
}
