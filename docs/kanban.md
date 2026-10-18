# Kanban Board

Lightweight planner for `at` implementation tasks. Machine-mutated by `at kanban` only.

* High-level planner only - details live in [`./docs/plans`](./plans). Time planning, plan files, keywords and compose: [kanban-compose.md](kanban-compose.md).
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

| ID  | Status  | Title                                 | Description                                                                                                                     | Priority | Owner | Blocks          | Blocked By          | Plan File                                          |
| :-- | :------ | :------------------------------------ | :------------------------------------------------------------------------------------------------------------------------------ | :------- | :---- | :-------------- | :------------------ | :------------------------------------------------- |
| T36 | Done    | Daemon hub + lock broker              | agents emit/discuss via daemon sock (drops per-run --sse hub); daemon serializes state.json/runs.jsonl writes                   | High     | loop  | T37             | T34                 | plans/T36-daemon-hub-lock-broker.md                |
| T37 | Backlog | Daemon tests + docs                   | lifecycle, stale sock/pid, crash recovery, version mismatch, fallback, perms tests; docs/daemon.md                              | Medium   | loop  | -               | T35,T36             | -                                                  |
| T38 | Backlog | WebUI Svelte 5 migration              | svelte 4→5 + vite plugin; runes-compatible build, svelte-check clean, all existing tests green, no UI change                    | High     | loop  | T39,T45         | T25                 | -                                                  |
| T39 | Backlog | WebUI design tokens                   | tailwind theme: semantic status/tier colors, type scale, 4px spacing, themes.css light/dark vars; replace hardcoded colors      | High     | loop  | T40             | T38                 | -                                                  |
| T40 | Backlog | WebUI ui primitives                   | common→`components/ui/<Name>/` w/ tests; add Modal, Table, EmptyState, Progress, Avatar; harden Button/Card/Badge/Tooltip       | High     | loop  | T41,T42,T43,T44 | T39                 | -                                                  |
| T41 | Backlog | WebUI responsive shell                | MainLayout+TopBar, collapsible sidebar groups, clear active state, mobile/tablet drawer, responsive grid                        | Medium   | loop  | T45             | T40,T49             | -                                                  |
| T42 | Backlog | Dashboard redesign                    | MetricCard trend arrows + threshold colors (low success=red), ActiveRuns empty-state CTA, RecentCompletions duration bars+sort  | Medium   | loop  | T45             | T40,T49             | -                                                  |
| T43 | Backlog | Run list upgrades                     | tooltips on truncated names, status hover, RunFilters, bulk select + kill/delete via existing API                               | Medium   | loop  | T45             | T40,T49             | -                                                  |
| T44 | Backlog | Agents view                           | own /agents route: AgentGrid grouped by tier, AgentCard stats, labeled enable/disable toggle, status clarity                    | Medium   | loop  | T45             | T40,T49             | -                                                  |
| T45 | Backlog | WebUI dir + runes stores              | components/features, lib/{api,sse,utils}, stores *.svelte.ts runes + index; imports updated, behavior unchanged                 | Medium   | loop  | T46             | T38,T41,T42,T43,T44 | -                                                  |
| T46 | Backlog | WebUI UX states                       | error boundaries, skeleton loading everywhere, empty states w/ CTA, success/error toast feedback on every action                | Medium   | loop  | T47             | T45                 | -                                                  |
| T47 | Backlog | WebUI a11y + responsive audit         | axe in Playwright, keyboard+SR pass, ARIA, WCAG AA contrast, 3 viewport E2E; fix findings                                       | Medium   | loop  | T48             | T46                 | -                                                  |
| T48 | Backlog | WebUI quality gates + docs            | coverage floor, bundle+Lighthouse (a11y>=90) gates re-pass, E2E new flows, design-system section in docs/webui.md               | Low      | loop  | -               | T47,T50             | -                                                  |
| T50 | Backlog | TUI layout parity                     | align src/tui to ui-spec: same nav/sections, dashboard metrics, agents view, status colors; spec-driven parity tests            | High     | loop  | T48             | T41,T42,T43,T44,T49 | -                                                  |
| T51 | Backlog | Fix 4 pre-existing unit-test failures | bridge-read fixture date rot (24h TTL), chop-logger shared tmpdir, ensureComposeFile stale embedded doc, AGENTS.md at 150 lines | Medium   | loop  | -               | -                   | plans/T51-fix-4-pre-existing-unit-test-failures.md |

## Loop

`/loop 30m docs/kanban-loop.md` - independent state-machine prompt that works this board via `at kanban` + `at compose`: [kanban-loop.md](kanban-loop.md).
Both `kanban-loop.md` and [kanban-compose.md](kanban-compose.md) are scaffolded next to the board when missing (`at kanban init`, `at kanban loop`); never overwritten.
