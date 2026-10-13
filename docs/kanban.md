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

| ID  | Status  | Title                          | Description                                                                                                                        | Priority | Owner | Blocks              | Blocked By          | Plan File                                    |
| :-- | :------ | :----------------------------- | :--------------------------------------------------------------------------------------------------------------------------------- | :------- | :---- | :------------------ | :------------------ | :------------------------------------------- |
| T1  | Done    | kanban core module             | src/kanban: mdast mutator, selection, lint, guard                                                                                  | Medium   | loop  | T2                  | -                   | -                                            |
| T2  | Done    | at kanban CLI                  | src/commands/kanban.ts subcommands wired into root program                                                                         | Medium   | loop  | T3                  | T1                  | -                                            |
| T3  | Done    | kanban test suite              | tests/kanban: parse, select, board, ops, lint, guard, cli                                                                          | Medium   | loop  | -                   | T2                  | -                                            |
| T4  | Done    | WebUI API server               | at web: REST+static+SSE over run-store/health/settings                                                                             | High     | loop  | -                   | -                   | docs/plans/webui-01-api-server.md            |
| T5  | Done    | WebUI scaffold                 | Vite+Svelte+Tailwind at src/webui, types, build scripts                                                                            | High     | loop  | -                   | -                   | docs/plans/webui-02-scaffold.md              |
| T6  | Done    | API client + SSE + stores      | fetch client, SSE reconnect manager, svelte stores                                                                                 | High     | loop  | -                   | T4,T5               | docs/plans/webui-03-api-sse-stores.md        |
| T7  | Done    | Layout + nav + common UI       | shell, sidebar nav, common components, badges                                                                                      | Medium   | loop  | -                   | T5                  | docs/plans/webui-04-layout-nav.md            |
| T8  | Done    | Sidebar run list + filter      | RunList/RunItem/FilterInput, date groups, virtual list                                                                             | Medium   | loop  | -                   | T6,T7               | docs/plans/webui-05-run-list.md              |
| T9  | Done    | Dashboard view                 | QuickStats, ActiveRuns, Recent, AgentsPanel                                                                                        | Medium   | loop  | -                   | T6,T7               | docs/plans/webui-06-dashboard.md             |
| T10 | Done    | New Task view                  | prompt form, tier/agent/mode/retries, submit                                                                                       | Medium   | loop  | -                   | T6,T7               | docs/plans/webui-07-new-task.md              |
| T11 | Done    | Run Details + LogViewer        | RunMeta, live log viewer, retry/kill/discuss                                                                                       | Medium   | loop  | -                   | T6,T7               | docs/plans/webui-08-run-details.md           |
| T12 | Done    | Settings view                  | defaults form persisted to backend state                                                                                           | Low      | loop  | -                   | T6,T7               | docs/plans/webui-09-settings.md              |
| T13 | Done    | Keyboard shortcuts + a11y      | TUI-mirroring keys, ARIA, contrast                                                                                                 | Low      | loop  | -                   | T8,T9,T10,T11,T12   | docs/plans/webui-10-keyboard.md              |
| T14 | Done    | E2E + integration tests        | Playwright vs at web with mock agents                                                                                              | Medium   | loop  | -                   | T13                 | docs/plans/webui-11-e2e-tests.md             |
| T15 | Done    | WebUI build, Docker, docs      | build wiring, Dockerfile, docs/webui.md, ci:check                                                                                  | Low      | loop  | -                   | T14                 | docs/plans/webui-12-build-docs.md            |
| T16 | Done    | Go backend core                | web-server/ Go module: read-only API + static server                                                                               | High     | loop  | -                   | T15                 | docs/plans/webui-13-go-backend-core.md       |
| T17 | Done    | Go backend mutations           | POST/DELETE runs, agents, contract tests node+go                                                                                   | High     | loop  | -                   | T16                 | docs/plans/webui-14-go-backend-mutations.md  |
| T18 | Done    | Go SSE hub + discuss           | hub-compatible events/emit/discuss in Go                                                                                           | High     | loop  | -                   | T17                 | docs/plans/webui-15-go-sse-hub.md            |
| T19 | Done    | Wire Go backend                | at web launches at-web; build:go, Dockerfile, docs                                                                                 | High     | loop  | -                   | T18                 | docs/plans/webui-16-go-integration-docker.md |
| T20 | Done    | Remove Node web server         | delete src/web/server.ts after Go e2e green                                                                                        | Medium   | loop  | -                   | T19                 | docs/plans/webui-17-remove-node-server.md    |
| T21 | Done    | SPA routing + lazy views       | history router, deep links, code-split views                                                                                       | Medium   | loop  | -                   | T15                 | docs/plans/webui-18-spa-routing.md           |
| T22 | Done    | PWA manifest                   | manifest, icons, install prompt                                                                                                    | Medium   | loop  | -                   | T21                 | docs/plans/webui-19-pwa-manifest.md          |
| T23 | Done    | Service worker                 | precache, SWR api cache, offline queue, SW messaging                                                                               | High     | loop  | -                   | T22                 | docs/plans/webui-20-service-worker.md        |
| T24 | Done    | WebUI performance              | preload/prefetch, brotli, budgets                                                                                                  | Medium   | loop  | -                   | T21                 | docs/plans/webui-21-performance.md           |
| T25 | Done    | PWA/perf E2E + Lighthouse      | offline e2e, lighthouse gate                                                                                                       | Medium   | loop  | -                   | T23,T24,T19         | docs/plans/webui-22-pwa-perf-e2e.md          |
| T26 | Backlog | at bridge core                 | src/commands/bridge.ts: 'at bridge \<res> \<verb>' JSON-in/out RPC, error envelope, exit codes, schema doc                         | High     | loop  | T27,T28,T29         | T25                 | -                                            |
| T27 | Backlog | bridge read ops                | bridge runs list\|get\|log, stats, agents list, settings get; reuse run-store/health/config, no new logic                          | High     | loop  | T30                 | T26                 | -                                            |
| T28 | Backlog | bridge mutations               | bridge run create\|retry\|delete, agent enable\|disable, settings put; wraps existing CLI/lib fns                                  | High     | loop  | T30                 | T26                 | -                                            |
| T29 | Backlog | bridge events + discuss        | bridge events/discuss via NDJSON stream; Go SSE becomes proxy to at serve hub                                                      | High     | loop  | T30                 | T26                 | -                                            |
| T30 | Backlog | Go thin proxy rewrite          | web-server only HTTP+static+SSE proxy; exec 'at bridge'; delete runs/state/settings/events pkgs                                    | High     | loop  | T31                 | T27,T28,T29,T32     | -                                            |
| T31 | Backlog | Bridge contract tests + docs   | vitest bridge schema tests, Go exec-stub tests, docs/webui.md+architecture, Dockerfile ships node+at                               | Medium   | loop  | -                   | T30                 | -                                            |
| T32 | Backlog | Single-binary at (bun compile) | bun build --compile → bin/at standalone; pnpm build:bin; smoke-test spawn/detach/bridge; Docker drops node                         | High     | loop  | T30                 | T26                 | -                                            |
| T33 | Backlog | Daemon core (atd)              | Go at-web as daemon: unix sock \~/.at/atd.sock 0600, pidfile, single-instance, version handshake, idle exit; at daemon start\|s... | High     | loop  | T34                 | T30                 | -                                            |
| T34 | Backlog | Daemon client in at CLI        | src/daemon-client.ts: auto-spawn like gradle, connect, fallback direct on fail; AT\_NO\_DAEMON + AT\_DEPTH loop guard              | High     | loop  | T35,T36             | T33                 | -                                            |
| T35 | Backlog | Daemon hot caches              | fsnotify-invalidated runs index, health, config, agent bin resolution; at status/scheduler read via daemon                         | High     | loop  | T37                 | T34                 | -                                            |
| T36 | Backlog | Daemon hub + lock broker       | agents emit/discuss via daemon sock (drops per-run --sse hub); daemon serializes state.json/runs.jsonl writes                      | High     | loop  | T37                 | T34                 | -                                            |
| T37 | Backlog | Daemon tests + docs            | lifecycle, stale sock/pid, crash recovery, version mismatch, fallback, perms tests; docs/daemon.md                                 | Medium   | loop  | -                   | T35,T36             | -                                            |
| T38 | Backlog | WebUI Svelte 5 migration       | svelte 4→5 + vite plugin; runes-compatible build, svelte-check clean, all existing tests green, no UI change                       | High     | loop  | T39,T45             | T25                 | -                                            |
| T39 | Backlog | WebUI design tokens            | tailwind theme: semantic status/tier colors, type scale, 4px spacing, themes.css light/dark vars; replace hardcoded colors         | High     | loop  | T40                 | T38                 | -                                            |
| T40 | Backlog | WebUI ui primitives            | common→components/ui/\<Name>/ w/ tests; add Modal, Table, EmptyState, Progress, Avatar; harden Button/Card/Badge/Tooltip           | High     | loop  | T41,T42,T43,T44     | T39                 | -                                            |
| T41 | Backlog | WebUI responsive shell         | MainLayout+TopBar, collapsible sidebar groups, clear active state, mobile/tablet drawer, responsive grid                           | Medium   | loop  | T45                 | T40,T49             | -                                            |
| T42 | Backlog | Dashboard redesign             | MetricCard trend arrows + threshold colors (low success=red), ActiveRuns empty-state CTA, RecentCompletions duration bars+sort     | Medium   | loop  | T45                 | T40,T49             | -                                            |
| T43 | Backlog | Run list upgrades              | tooltips on truncated names, status hover, RunFilters, bulk select + kill/delete via existing API                                  | Medium   | loop  | T45                 | T40,T49             | -                                            |
| T44 | Backlog | Agents view                    | own /agents route: AgentGrid grouped by tier, AgentCard stats, labeled enable/disable toggle, status clarity                       | Medium   | loop  | T45                 | T40,T49             | -                                            |
| T45 | Backlog | WebUI dir + runes stores       | components/features, lib/{api,sse,utils}, stores \*.svelte.ts runes + index; imports updated, behavior unchanged                   | Medium   | loop  | T46                 | T38,T41,T42,T43,T44 | -                                            |
| T46 | Backlog | WebUI UX states                | error boundaries, skeleton loading everywhere, empty states w/ CTA, success/error toast feedback on every action                   | Medium   | loop  | T47                 | T45                 | -                                            |
| T47 | Backlog | WebUI a11y + responsive audit  | axe in Playwright, keyboard+SR pass, ARIA, WCAG AA contrast, 3 viewport E2E; fix findings                                          | Medium   | loop  | T48                 | T46                 | -                                            |
| T48 | Backlog | WebUI quality gates + docs     | coverage floor, bundle+Lighthouse (a11y>=90) gates re-pass, E2E new flows, design-system section in docs/webui.md                  | Low      | loop  | -                   | T47,T50             | -                                            |
| T49 | Backlog | Shared TUI/WebUI layout spec   | docs/layout.md is canonical ASCII layout; add src/ui-spec.ts (nav, sections, tokens) mirroring it, used by both UIs                | High     | loop  | T41,T42,T43,T44,T50 | T25                 | docs/layout.md                               |
| T50 | Backlog | TUI layout parity              | align src/tui to ui-spec: same nav/sections, dashboard metrics, agents view, status colors; spec-driven parity tests               | High     | loop  | T48                 | T41,T42,T43,T44,T49 | -                                            |

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
