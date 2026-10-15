export const LEGEND_SECTION = `## Status Legend

| Status        | Meaning                                                       | Who updates it  |
| ------------- | ------------------------------------------------------------- | --------------- |
| \`Backlog\`     | Task is defined but not yet started.                          | Planner / agent |
| \`In Progress\` | An agent is actively working the task.                        | Coding agent    |
| \`Blocked\`     | Cannot continue until another task or issue is resolved.      | Coding agent    |
| \`Done\`        | Task completed and accepted.                                  | Coding agent    |
`;

export const BOARD_HEADER = `| ID | Status | Title | Description | Priority | Owner | Blocks | Blocked By | Plan File | Est Time | Est Tokens |
| :-- | :-- | :-- | :-- | :-- | :-- | :-- | :-- | :-- | :-- | :-- |`;

export function initBoardText(): string {
  return `# Kanban Board

Lightweight planner for \`at\` implementation tasks. Machine-mutated by \`at kanban\` only.

* High-level planner only — details live in [\`./docs/plans\`](./plans).
* The agent **must** move \`Status\` when taking a task and again when the work is done.
* Rows stay sorted by \`ID\`; \`at kanban add\` enforces this mechanically.

${LEGEND_SECTION}
## Task Board

${BOARD_HEADER}
`;
}
