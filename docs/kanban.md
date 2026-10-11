# Kanban Board

Lightweight planner for `at` implementation tasks. Machine-mutated by `at kanban` only.

* High-level planner only — details live in [`./docs/plans`](./plans).
* The agent **must** move `Status` when taking a task and again when the work is done.
* Rows stay sorted by `ID`; `at kanban add` enforces this mechanically.

## Status Legend

| Status        | Meaning                                                  | Who updates it  |
| ------------- | -------------------------------------------------------- | --------------- |
| `Backlog`     | Task is defined but not yet started.                     | Planner / agent |
| `In Progress` | An agent is actively working the task.                   | Coding agent    |
| `Blocked`     | Cannot continue until another task or issue is resolved. | Coding agent    |
| `Done`        | Task completed and accepted.                             | Coding agent    |

## Task Board

| ID | Status | Title              | Description                                                | Priority | Owner | Blocks | Blocked By | Plan File |
| :- | :----- | :----------------- | :--------------------------------------------------------- | :------- | :---- | :----- | :--------- | :-------- |
| T1 | Done   | kanban core module | src/kanban: mdast mutator, selection, lint, guard          | Medium   | loop  | T2     | -          | -         |
| T2 | Done   | at kanban CLI      | src/commands/kanban.ts subcommands wired into root program | Medium   | loop  | T3     | T1         | -         |
| T3 | Done   | kanban test suite  | tests/kanban: parse, select, board, ops, lint, guard, cli  | Medium   | loop  | -      | T2         | -         |

## Compose + Kanban

`at compose` can drive the board directly. Compose stays kanban-free except for
one adapter (`src/compose/kanban-source.ts`); the board is still human-edited and
every adapter op re-loads it under the kanban file lock.

```bash
at compose --task T7                 # claim T7 (Backlog -> In Progress) and compose it
at compose --loop                    # claim -> compose -> repeat until nothing is executable
at compose --loop --stop-on-fail     # stop the loop after the first FAILED run
at compose --loop --board <file>     # use a non-default board
```

* Goal text comes from the task's Title + Description (+ `Plan File` content when set).
* goalId is the task id lowercased (`T7` -> `~/.at/compose/t7/`), so re-running is an
  implicit `--resume`: a non-terminal `state.json` continues, a terminal one is skipped.
* DONE -> `Done`; FAILED -> `Blocked` + an `outcome.md` in the goal dir, and `Plan File`
  is set (only when still `-`) to the compose plan. The loop then continues with the
  next executable task (`Blocked By` dependencies gate on `Done`).
* Exit code: 0 when no task FAILED, 1 otherwise.
* `--prompt`/`--goal` still work as before and need no board.
