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

| ID  | Status  | Title                     | Description                                                | Priority | Owner | Blocks | Blocked By        | Plan File                             |
| :-- | :------ | :------------------------ | :--------------------------------------------------------- | :------- | :---- | :----- | :---------------- | :------------------------------------ |
| T1  | Done    | kanban core module        | src/kanban: mdast mutator, selection, lint, guard          | Medium   | loop  | T2     | -                 | -                                     |
| T2  | Done    | at kanban CLI             | src/commands/kanban.ts subcommands wired into root program | Medium   | loop  | T3     | T1                | -                                     |
| T3  | Done    | kanban test suite         | tests/kanban: parse, select, board, ops, lint, guard, cli  | Medium   | loop  | -      | T2                | -                                     |
| T4  | Done    | WebUI API server          | at web: REST+static+SSE over run-store/health/settings     | High     | loop  | -      | -                 | docs/plans/webui-01-api-server.md     |
| T5  | Done    | WebUI scaffold            | Vite+Svelte+Tailwind at src/webui, types, build scripts    | High     | loop  | -      | -                 | docs/plans/webui-02-scaffold.md       |
| T6  | Done    | API client + SSE + stores | fetch client, SSE reconnect manager, svelte stores         | High     | loop  | -      | T4,T5             | docs/plans/webui-03-api-sse-stores.md |
| T7  | Done    | Layout + nav + common UI  | shell, sidebar nav, common components, badges              | Medium   | loop  | -      | T5                | docs/plans/webui-04-layout-nav.md     |
| T8  | Backlog | Sidebar run list + filter | RunList/RunItem/FilterInput, date groups, virtual list     | Medium   | loop  | -      | T6,T7             | docs/plans/webui-05-run-list.md       |
| T9  | Backlog | Dashboard view            | QuickStats, ActiveRuns, Recent, AgentsPanel                | Medium   | loop  | -      | T6,T7             | docs/plans/webui-06-dashboard.md      |
| T10 | Backlog | New Task view             | prompt form, tier/agent/mode/retries, submit               | Medium   | loop  | -      | T6,T7             | docs/plans/webui-07-new-task.md       |
| T11 | Backlog | Run Details + LogViewer   | RunMeta, live log viewer, retry/kill/discuss               | Medium   | loop  | -      | T6,T7             | docs/plans/webui-08-run-details.md    |
| T12 | Backlog | Settings view             | defaults form persisted to backend state                   | Low      | loop  | -      | T6,T7             | docs/plans/webui-09-settings.md       |
| T13 | Backlog | Keyboard shortcuts + a11y | TUI-mirroring keys, ARIA, contrast                         | Low      | loop  | -      | T8,T9,T10,T11,T12 | docs/plans/webui-10-keyboard.md       |
| T14 | Backlog | E2E + integration tests   | Playwright vs at web with mock agents                      | Medium   | loop  | -      | T13               | docs/plans/webui-11-e2e-tests.md      |
| T15 | Backlog | WebUI build, Docker, docs | build wiring, Dockerfile, docs/webui.md, ci:check          | Low      | loop  | -      | T14               | docs/plans/webui-12-build-docs.md     |

## Compose + Kanban

The board is the human-readable durable backlog; `at compose` is the machine that works it. All
compose run detail (state machine, rounds, in-flight runIds) lives outside the board in
`~/.at/compose/<goalId>/` — only the `Status` / `Plan File` cells are ever touched.

```bash
at compose --task T7                 # claim T7 (Backlog -> In Progress) and compose it
at compose --loop                    # claim -> compose -> repeat until nothing is executable
at compose --loop --stop-on-fail     # stop the loop after the first FAILED run
at compose --loop --board <file>     # use a non-default board
```

* Goal text comes from the task's Title + Description (+ `Plan File` content when set).
* goalId is the task id lowercased (`T7` -> `~/.at/compose/t7/`), so re-running is an
  implicit `--resume`: a non-terminal `state.json` continues, a terminal one is skipped.
* Status mapping (configurable via `statusMap` in `createKanbanSource`):

  | Compose event             | Board status                                                                                        |
  | ------------------------- | --------------------------------------------------------------------------------------------------- |
  | claim (`--task`/`--loop`) | `In Progress`                                                                                       |
  | run DONE                  | `Done`                                                                                              |
  | run FAILED                | `Blocked` (+ `outcome.md` in the goal dir; `Plan File` set to the compose plan only when still `-`) |

  The loop then continues with the next executable task (`Blocked By` dependencies gate on `Done`).
  A status missing from the board's legend is warned about and the row is left unchanged.
* **Claim lease:** every claim takes a per-task pid lock (`src/lock.ts`, written to `<boardDir>/locks/`
  under the name of `<boardFile>.claim-<ID>`) and holds it until `onFinish` releases it; a lock whose pid
  died is stale-stolen, so a crashed run frees its own task. `claim()` resumes the first **unleased** task
  already in the claim status (crash or human hand-off) before taking the best unblocked `Backlog` row, and
  skips any row leased by a live pid — two claimers can never be handed the same task.
* **Locking:** every board op (claim, finish) goes through `mutateBoard` (`src/kanban/board.ts`) —
  load → mutate → save inside the `withLock` file mutex, written atomically via
  `src/atomic-write.ts` (temp file + same-dir rename). The lease is taken inside that same mutex, so the
  lease and the `Status` cell land together. Nothing caches board state between ops, so
  **humans may edit the board concurrently**: the next compose op re-loads their changes instead of
  clobbering them.
* Exit code: 0 when no task FAILED, 1 otherwise (also 1 for an unknown `--task <id>`).
* `--prompt`/`--goal` still work as before and need no board. Full flag/state-machine reference:
  [cli.md#compose-plan--implement--check](cli.md#compose-plan--implement--check).
