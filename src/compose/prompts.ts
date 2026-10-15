import path from "node:path";
import { PLAN_FILE, VERDICT_FILE } from "./workspace";

export interface PlanPromptInput {
  goal: string;
  context: string;
  workspaceDir: string;
  findings?: string;
}

export interface ImplementPromptInput {
  goal: string;
  task: string;
  plan: string;
  workspaceDir: string;
  /** Experimental discuss channel on: implementer may `at discuss ask` the orchestrator. */
  discuss?: boolean;
}

export interface SingleImplementPromptInput {
  goal: string;
  context: string;
  workspaceDir: string;
  /** Test output of the previous round (set on a fix round). */
  findings?: string;
}

export interface CheckPromptInput {
  goal: string;
  plan: string;
  testCmd: string;
  testExitCode: number;
  testOutput: string;
  diff: string;
  workspaceDir: string;
}

export function buildPlanPrompt(input: PlanPromptInput): string {
  const planPath = path.join(input.workspaceDir, PLAN_FILE);
  const sections = [
    "You are the architect (high tier). Plan the work. Do not implement it.",
    "",
    "## Goal",
    input.goal,
    "",
    "## Codebase context",
    input.context.trim() || "(no context gathered)",
    "",
  ];

  if (input.findings) {
    sections.push(
      "## Previous verdict — FAIL, findings to address",
      input.findings.trim(),
      "",
      "## Re-plan rules",
      `Read the existing ${planPath} and APPEND new unchecked tasks that fix the findings above.`,
      "Append-only: never delete, rewrite, or untick tasks that are already in the checklist.",
      "Continue the existing numbering.",
      "",
    );
  }

  sections.push(
    "## Output",
    `Write ${planPath} with exactly these sections:`,
    "",
    '1. `## Requirements` — what "done" means, verifiably.',
    "2. `## Design` — short design notes: files touched, interfaces, data shape, test strategy.",
    "3. `## Tasks` — an ordered checklist, one task per line, numbered sequentially:",
    "",
    "- [ ] 1. First task",
    "- [ ] 2. Second task",
    "",
    "Every task must start with `- [ ]` so it can be tracked. Keep tasks small enough for one",
    "implementer pass, and order them so each one leaves the tree buildable.",
  );

  return sections.join("\n");
}

export function buildImplementPrompt(input: ImplementPromptInput): string {
  const planPath = path.join(input.workspaceDir, PLAN_FILE);
  return [
    "You are the implementer (low tier). Implement exactly one task from the plan.",
    "",
    "## Goal",
    input.goal,
    "",
    "## Your task",
    input.task,
    "",
    "## Plan",
    input.plan.trim(),
    "",
    "## Rules",
    `- The plan lives at ${planPath}. Do not edit it — do not tick checkboxes or add tasks; the orchestrator tracks that.`,
    "- Change only what this task needs. Follow the conventions already in the repo.",
    "- Run the tests that cover the files you touched before you finish.",
    ...(input.discuss
      ? [
          '- If you are blocked or the task is ambiguous, run `$AT_BIN discuss ask "<question>" -o A -o B`',
          "  and follow the answer; do not guess.",
        ]
      : ["- Do not ask questions: make the most reasonable assumption and state it in your final message."]),
  ].join("\n");
}

/** One-agent prompt: the goal (with any existing plan file embedded) is the spec; follow it end to end. */
export function buildSingleImplementPrompt(input: SingleImplementPromptInput): string {
  const sections = [
    "You are the implementer. Complete the whole goal in this single run.",
    "",
    "## Goal",
    input.goal,
    "",
    "## Codebase context",
    input.context.trim() || "(no context gathered)",
    "",
  ];
  if (input.findings) {
    sections.push("## Previous attempt — tests FAILED, fix these", input.findings.trim(), "");
  }
  sections.push(
    "## Rules",
    "- If the goal contains an `## Existing plan`, follow it in order; do not re-plan or widen scope.",
    "- Follow the conventions already in the repo. Change only what the goal needs.",
    "- Run the tests that cover the files you touched before you finish; fix failures yourself.",
    `- Scratch notes, if any, go under ${input.workspaceDir}. Do not ask questions: make the most reasonable assumption and state it in your final message.`,
  );
  return sections.join("\n");
}

export function buildCheckPrompt(input: CheckPromptInput): string {
  const verdictPath = path.join(input.workspaceDir, VERDICT_FILE);
  return [
    "You are the reviewer (high tier). Judge whether the goal is met. Do not change any code.",
    "",
    "## Goal",
    input.goal,
    "",
    "## Plan (with task status)",
    input.plan.trim(),
    "",
    "## Test run",
    `command: ${input.testCmd}`,
    `exit code: ${input.testExitCode}`,
    "",
    "```",
    input.testOutput.trim() || "(no output)",
    "```",
    "",
    "## git diff",
    "",
    "```diff",
    input.diff.trim() || "(empty diff)",
    "```",
    "",
    "## Output",
    `Write ${verdictPath}. Its first line must be exactly PASS or FAIL — nothing else on that line.`,
    "After that line, list your findings: what is missing, wrong, or untested, with file:line",
    "references. On FAIL the findings are handed back to the architect for re-planning, so make",
    "them concrete and actionable.",
    "If the test exit code above is not 0, the verdict CANNOT be PASS — use FAIL and explain.",
  ].join("\n");
}

export interface BrainPromptInput {
  goal: string;
  plan: string;
  question: string;
  options?: string[];
}

/** Short tier-1 prompt that answers one implementer question. Reply = one line. */
export function buildBrainPrompt(input: BrainPromptInput): string {
  const sections = [
    "You are the orchestrator brain (architect). An implementing agent asked a question.",
    "Reply with exactly one line: the answer only, no explanation, no preamble.",
    "",
    "## Goal",
    input.goal,
    "",
    "## Plan",
    input.plan.trim() || "(no plan)",
    "",
    "## Question",
    input.question,
    "",
  ];
  if (input.options?.length) {
    sections.push("## Options", input.options.map((o) => `- ${o}`).join("\n"), "");
  }
  return sections.join("\n");
}
