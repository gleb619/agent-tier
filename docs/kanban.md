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

## Time planning + consumption

Two optional trailing columns plan a task: `Est Time` (wall-time budget) and `Planned` (start date,
`YYYY-MM-DD`); `-` = unset. Boards that predate them keep working — the first `at kanban add` that
uses `--est-time` / `--planned` appends just that column (every other row gets `-`). `at kanban init`
templates include both. Old `Est Tokens` columns are harmless leftovers: nothing reads them.

```bash
at kanban add --id T60 --title "x" --est-time 45m --planned 2026-11-03   # 45m, 2h, 1h30m · calendar date
```

Consumption is **time only** and is not written to the board (it stays small and diff-friendly):

* Compose (`--task` / `--loop`) copies each finished run's wall time (retries included) to the durable
  `<stateDir>/task-metrics.jsonl` (`runs.jsonl` is pruned at 24h/30 runs), keyed by task id, and tags the run with `taskId`.
* Run Details shows the task's consumed-vs-planned time (green ≤ plan, yellow ≤ +25%, red above);
  the Dashboard shows total time, over-budget task count and the consumed÷planned ratio.
  WebUI reads `GET /api/usage` (`at bridge usage summary`).

## Plan files + keywords

`at kanban add --plan <path>` creates the plan file when it is missing, from a skeleton whose first
section is `## Keywords` (then Requirements / Design / Tasks). `--keywords a,b` fills it — and when the
row has no plan file yet, links a default `plans/<ID>-<slug>.md` first. On an existing plan without
keywords the section is inserted after the title; existing keywords are never rewritten.

```bash
at kanban add --id T61 --title "login flow" --keywords "auth, jwt, src/auth/login.ts"
```

`at compose` reads the keywords (see [cli.md](cli.md#keywords--investigate-context)) and uses them as
the `at index` / codegraph query in INVESTIGATE, so keep them to concrete symbols, paths and concepts.

## Compose + Kanban

The board is the human-readable durable backlog; `at compose` is the machine that works it. All
compose run detail (state machine, rounds, in-flight runIds) lives outside the board in
`~/.at/compose/<goalId>/` — only the `Status` / `Plan File` cells are ever touched.

```bash
at compose --task T7                 # claim T7 (Backlog -> In Progress) and compose it
at compose --loop                    # claim -> compose -> repeat until nothing is executable
at compose --loop --stop-on-fail     # stop the loop after the first FAILED run
at compose --loop --board <file>     # use a non-default board
at compose --loop --worktree --merge # each task in its own worktree, merged to main when DONE
at compose --loop --follow 60        # board drained? sleep 60s and poll again (until Ctrl-C)
at compose --loop --max-tasks 3      # cap an unattended run
at compose --loop --worktree --merge --follow --background   # detached, survives the terminal
at compose jobs | logs <name> | stop <name>                  # manage background jobs
```

### Follow flow (poll → take → work → repeat)

```
at kanban next [--json]        POLL   first unblocked task: In Progress wins, else Backlog by priority then ID
        │                              (read-only, free; exit 0 + "no executable task" when drained)
        ▼
compose claims (lease + In Progress)   TAKE   pid lease; a live holder's task is skipped, a dead one resumed
        │  --worktree: git worktree add ../<repo>-<id> -b feat/<id> main   (reused on resume)
        ▼
single implementer + --test-cmd gate  WORK   cwd = the task worktree
        │  DONE → Done · FAILED → Blocked (+ outcome.md)
        │  --merge (DONE only): scripts/merge-worktree.sh = rebase + ff-merge + cleanup
        ▼
next claim … drained → exit, or with --follow sleep + poll again
```

* **Poll** = `at kanban next` (same `nextExecutable` rule the loop uses, one selection rule for both).
  `Blocked By` ids must be `Done`; unknown blocker ids are ignored.
* **Worktree** (`--worktree`): path `<repo>-<id-lowercase>` next to the main checkout, branch `feat/<id>`.
  Existing worktree/branch is reused, so a resumed task continues where it stopped. If creation fails the
  task is marked FAILED (→ Blocked) and not run — never silently composed in the shared checkout.
* **Merge** (`--merge`, needs `--worktree`): only after DONE (gate green). Needs the agent to have
  *committed* in the worktree; `DIRTY_WORKTREE` / `REBASE_CONFLICT` / `MERGE_FAIL` / `MAIN_NOT_ON_<base>`
  fail the task run, leave the worktree intact and halt the loop (next task must not build on an
  unmerged base). Without `--merge` the worktree + branch stay for human review.
* **Works in any git repo** (no `scripts/` needed): the project's own `scripts/merge-worktree.sh` is used
  when it exists (it may carry project steps); otherwise the built-in merge does the same sequence —
  clean-tree check, `git rebase <base>` (aborted on conflict), `merge --ff-only` from the main checkout,
  then worktree + branch removal. Nothing is written into the repo. Base branch = `AT_BASE_BRANCH`, else
  origin's HEAD, else `main`/`master`, else the main checkout's current branch. A new worktree also
  symlinks the main checkout's `node_modules` when present (like `scripts/worktree-new.sh`).

### Background jobs

`--background` (with `--task`/`--loop`) re-launches `at compose …` detached and returns at once.

```bash
at compose --loop --worktree --merge --follow 60 --max-tasks 20 --background --name nightly
at compose jobs              # name · running|exited · pid · started · cwd
at compose logs nightly -n 80
at compose stop nightly      # finish the in-flight task, then exit (resumable); --force = SIGKILL
```

* Job records + logs: `<stateDir>/compose-jobs/<name>.{json,log}` — project `.at/` when it exists
  (has `state.json`/`runs.jsonl`), else `~/.at/`; run `jobs`/`logs`/`stop` from the same project.
  Default name = lowercase task id, else `loop`; a live job with the same name is refused.

* The job runs in the cwd it was started from, so board / worktree resolution is the same as foreground.

* A crashed or stopped job is resumed by starting it again — claims resume the leased/in-progress task
  and `state.json` continues the run. It is not a system service: after a reboot start it again
  (or schedule `at compose --loop --background` from cron/systemd).

* **Follow** (`--follow [seconds]`, default 60, needs `--loop`): when nothing is executable the loop
  sleeps and re-polls, so tasks added by humans/`at kanban add` are picked up. First Ctrl-C/SIGTERM ends
  the loop after the in-flight task (resumable via `state.json`); second exits at once.
  Pair with `--max-tasks <n>` as a spend cap. For an external scheduler instead, run
  `at compose --loop` per tick (`/loop 30m …`) — a drained board exits 0 and costs nothing.

* **Default = one implementer run**: the plan file is the spec, so there is no tier-1 PLAN/CHECK — the
  implementer follows it and `--test-cmd` gates DONE. Opt in to the tier-1 pipeline with `--plan-then-do` /
  `AT_PLAN_THEN_DO=1` (see [cli.md](cli.md#compose-single-run-by-default-plan-then-do-opt-in)).

* **Plan-file keywords:** a `## Keywords` section (bullets or comma list; scaffolded by `at kanban add --plan`),
  or `keywords: a, b` (front matter) / a `Keywords: a, b` line (also `labels:` / `tags:`) in the first 30 lines
  of the plan file. INVESTIGATE feeds them to `codegraph context` as the
  query (instead of the whole goal text) to bootstrap `context.md`. The board schema is unchanged.

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
