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
  ].join("\n");
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
  ].join("\n");
}
