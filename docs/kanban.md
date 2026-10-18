# Kanban Board

Lightweight planner for `at` implementation tasks. Machine-mutated by `at kanban` only.

* High-level planner only — details live in [`./docs/plans`](./plans). Time planning, plan files, keywords and compose: [kanban-compose.md](kanban-compose.md).
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

| ID  | Status  | Title                          | Description                                                                                                                         | Priority | Owner | Blocks              | Blocked By          | Plan File      |
| :-- | :------ | :----------------------------- | :---------------------------------------------------------------------------------------------------------------------------------- | :------- | :---- | :------------------ | :------------------ | :------------- |
| T26 | Done    | at bridge core                 | src/commands/bridge.ts: `at bridge <res> <verb>` JSON-in/out RPC, error envelope, exit codes, schema doc                          | High     | loop  | T27,T28,T29         | T25                 | -              |
| T27 | Done    | bridge read ops                | bridge runs list/get, status get, agents list/health, feedback list/get, kanban list/show/next, config get; reuse existing libs | High     | loop  | T30                 | T26                 | -              |
| T28 | Done    | bridge mutations               | bridge runs stop/stop-all, feedback add/update/resolve/rm, kanban add/status/remove, line add/rm/move; wraps existing fns   | High     | loop  | T30                 | T26                 | -              |
| T29 | Done    | bridge events + discuss        | bridge events tail, discuss list/thread/answer/say, health get; wraps notify/store + discuss-store + status-report               | High     | loop  | T30                 | T26                 | -              |
| T30 | Done    | Go thin proxy rewrite          | web-server only HTTP+static+SSE proxy; exec 'at bridge'; delete runs/state/settings/events pkgs                                     | High     | loop  | T31                 | T27,T28,T29,T32     | -              |
| T31 | Done    | Bridge contract tests + docs   | vitest bridge schema tests, Go exec-stub tests, docs/webui.md+architecture, Dockerfile ships node+at                                | Medium   | loop  | -                   | T30                 | -              |
| T32 | Done    | Single-binary at (bun compile) | bun build --compile → bin/at standalone; pnpm build:bin; smoke-test spawn/detach/bridge; Docker drops node                          | High     | loop  | T30                 | T26                 | -              |
| T33 | Done    | Daemon core (atd)              | Go at-web as daemon: unix sock ~/.at/atd.sock 0600, pidfile, single-instance, version handshake, idle exit; at daemon start/s...  | High     | loop  | T34                 | T30                 | -              |
| T34 | Done    | Daemon client in at CLI        | src/daemon-client.ts: auto-spawn like gradle, connect, fallback direct on fail; AT_NO_DAEMON + AT_DEPTH loop guard               | High     | loop  | T35,T36             | T33                 | -              |
| T35 | Done    | Daemon hot caches              | fsnotify-invalidated runs index, health, config, agent bin resolution; at status/scheduler read via daemon                          | High     | loop  | T37                 | T34                 | -              |
| T36 | Backlog | Daemon hub + lock broker       | agents emit/discuss via daemon sock (drops per-run --sse hub); daemon serializes state.json/runs.jsonl writes                       | High     | loop  | T37                 | T34                 | -              |
| T37 | Backlog | Daemon tests + docs            | lifecycle, stale sock/pid, crash recovery, version mismatch, fallback, perms tests; docs/daemon.md                                  | Medium   | loop  | -                   | T35,T36             | -              |
| T38 | Backlog | WebUI Svelte 5 migration       | svelte 4→5 + vite plugin; runes-compatible build, svelte-check clean, all existing tests green, no UI change                        | High     | loop  | T39,T45             | T25                 | -              |
| T39 | Backlog | WebUI design tokens            | tailwind theme: semantic status/tier colors, type scale, 4px spacing, themes.css light/dark vars; replace hardcoded colors          | High     | loop  | T40                 | T38                 | -              |
| T40 | Backlog | WebUI ui primitives            | common→`components/ui/<Name>/` w/ tests; add Modal, Table, EmptyState, Progress, Avatar; harden Button/Card/Badge/Tooltip            | High     | loop  | T41,T42,T43,T44     | T39                 | -              |
| T41 | Backlog | WebUI responsive shell         | MainLayout+TopBar, collapsible sidebar groups, clear active state, mobile/tablet drawer, responsive grid                            | Medium   | loop  | T45                 | T40,T49             | -              |
| T42 | Backlog | Dashboard redesign             | MetricCard trend arrows + threshold colors (low success=red), ActiveRuns empty-state CTA, RecentCompletions duration bars+sort      | Medium   | loop  | T45                 | T40,T49             | -              |
| T43 | Backlog | Run list upgrades              | tooltips on truncated names, status hover, RunFilters, bulk select + kill/delete via existing API                                   | Medium   | loop  | T45                 | T40,T49             | -              |
| T44 | Backlog | Agents view                    | own /agents route: AgentGrid grouped by tier, AgentCard stats, labeled enable/disable toggle, status clarity                        | Medium   | loop  | T45                 | T40,T49             | -              |
| T45 | Backlog | WebUI dir + runes stores       | components/features, lib/{api,sse,utils}, stores *.svelte.ts runes + index; imports updated, behavior unchanged                    | Medium   | loop  | T46                 | T38,T41,T42,T43,T44 | -              |
| T46 | Backlog | WebUI UX states                | error boundaries, skeleton loading everywhere, empty states w/ CTA, success/error toast feedback on every action                    | Medium   | loop  | T47                 | T45                 | -              |
| T47 | Backlog | WebUI a11y + responsive audit  | axe in Playwright, keyboard+SR pass, ARIA, WCAG AA contrast, 3 viewport E2E; fix findings                                           | Medium   | loop  | T48                 | T46                 | -              |
| T48 | Backlog | WebUI quality gates + docs     | coverage floor, bundle+Lighthouse (a11y>=90) gates re-pass, E2E new flows, design-system section in docs/webui.md                   | Low      | loop  | -                   | T47,T50             | -              |
| T49 | Done    | Shared TUI/WebUI layout spec   | docs/layout.md is canonical ASCII layout; add src/ui-spec.ts (nav, sections, tokens) mirroring it, used by both UIs                 | High     | loop  | T41,T42,T43,T44,T50 | T25                 | docs/layout.md |
| T50 | Backlog | TUI layout parity              | align src/tui to ui-spec: same nav/sections, dashboard metrics, agents view, status colors; spec-driven parity tests                | High     | loop  | T48                 | T41,T42,T43,T44,T49 | -              |

## Loop prompt (paste into Claude Code)

Paste the line below into the Claude Code console. Claude re-runs the prompt every 30 minutes and works this
board through the `at` CLI (`at kanban` + `at compose`); it does not edit code or the board itself.

```text
/loop 30m Work the kanban board docs/kanban.md with the `at` CLI. Never edit the board or code by hand; never use git stash/reset; no plan-then-do; one `at` job at a time. Each tick:
1) `at compose jobs` — if job "loop" is running: run `at compose logs loop -n 20`, report one line, end the tick.
2) `at kanban lint` — on violations report them and stop.
3) `at kanban next` — if it prints "No executable task found.": report "board drained", cancel this loop (CronDelete), stop.
4) Otherwise start `at compose --loop --worktree --merge --max-tasks 3 --stop-on-fail --test-cmd 'npx vitest run tests' --background --name loop`. A task without a plan file or without `## Keywords` / `## Time` (Planned) gets one first: `at kanban add --id <ID> --keywords "<symbols, paths>"`, then have the planner agent fill `Planned: <duration>` and run `at kanban estimate <ID>`.
5) Review finished work: `at kanban list`; for each row now `Blocked` read `~/.at/compose/<id lowercase>/outcome.md`, report the cause, do not retry more than once. For each newly `Done` task run `npx tsc --noEmit` and `pnpm exec biome ci .` on main; failure -> `at feedback add -k bug` and stop.
Report at most 5 lines per tick: tasks Done / Blocked / running, time consumed vs planned.
```

* Cheap by design: a drained board costs no agent runs, and a tick that finds a running job only reads its log.
* Stop it: `at compose stop loop` (finishes the in-flight task; resumable), then cancel the `/loop`.
* Without Claude: `at compose --loop --worktree --merge --follow 60 --max-tasks 20 --background` does the same polling in one process.
