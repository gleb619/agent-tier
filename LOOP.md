# Autonomous Improvement Loop

`/loop 30m LOOP.md`

State-machine prompt for a coding agent that improves `at` itself. Work source is the
feedback queue (managed by `at feedback`, db `~/.at/feedback.jsonl`). Cycle:
**poll → fix → verify → close → poll**. When no workable feedback is left, the loop
stops: schedules/crons are cancelled and the agent exits.

Feed this file as the prompt on every tick. One tick = advance the machine until it
reaches a tick boundary (marked ⏸), then end the turn.

## Required Skills

Invoke before any work:

- `caveman` — compressed communication throughout all sessions
- `codegraph` — codebase exploration; never grep when `codegraph_*` tools are available
- `delegate-with-at` — delegate code writing to subagents via the `at` CLI

## Rules

- Work in this repo (agent-tier). Touch only what the entry needs; others edit
  concurrently, ignore unrelated failures.
- Never `git commit`, `git push`, `git reset`, or edit `~/.at/*` by hand. Use the
  `at feedback` CLI for all queue and log changes.
- Never remove an entry before the fix is verified.
- Use `node dist/cli.js` (after `pnpm run build`) or `npx ts-node src/cli.ts` if `at` is
  not on PATH.
- **Who writes code** (decided in TRIAGE):
  - **SMALL** (≤5 files, one concern, obvious fix, <~100 lines): you, the loop agent,
    edit directly. No delegation.
  - **COMPLEX** (5+ files, refactor, design choice, new module, or needs long-running
    work): you plan, `at` agents write (SubState DELEGATE).
- You are not alone, focus on your task, ignore other errors.
- Keep caveman/ultra-brief responses to user when reporting progress.
- Minimal texting, save tokens. 

## Progress log (state lives in the feedback entry)

No external state file. Every transition is recorded on the entry itself:

```bash
at feedback log <id> "<note>" --state <STATE> [--sub <SUB>] -o try|ok|failed|info \
  [-r <runId>] [-f <file...>]
```

- Log items are stored in `feedback.jsonl` under the entry's `log` array and **expire
  after 7 days** (`AT_FEEDBACK_LOG_TTL_MS`, or `state.json` `{"feedback":{"logTtlMs"}}`);
  max 50 items per entry. Expired failures stop counting, so a stuck entry is retried
  after the TTL.
- `at feedback show <id> --json` returns `log`. The **last item** is the resume point;
  a fresh context continues from its `state`/`subState`.
- **Attempts** = number of `failed` items currently in `log` (within TTL).
- Log at least: TRIAGE result (`info`), each DELEGATE (`try` + `-r runId`), each REVIEW /
  VERIFY failure (`failed` + reason), and the final CLOSE (`ok`/`failed`, `-f` files).
- Keep per-run counters (`done`, `consecutiveFailures`) in your own context; they reset
  each tick/run, which is fine.

## State machine

```
POLL ─► ANALYZE ─► TRIAGE ─► PLAN ─► EXECUTE ─► VERIFY ─► CLOSE ─► REPORT ─► POLL
  │                  │                  │          │ fail                │
  │ nothing workable │ SMALL: skip PLAN │ DELEGATE→WAIT→REVIEW→RETRY     │ 3 fails / cap 5
  ▼                  ▼  go EXECUTE/EDIT ▼                                 ▼
 STOP ◄─────────────────────────────────────────────────────────────────┘
```

### State: POLL

1. `at feedback list --status open --json -n 150`.
2. Skip entries with ≥3 `failed` log items. Pick the entry with a recent non-terminal
   `log` item first (resume), else oldest `createdAt`, preferring kind `bug`, then
   `improvement`, then `note`.
3. Found → **ANALYZE** (or resume at the last logged state).
   None workable (queue empty or all exhausted) → **STOP**.

### State: ANALYZE

Read-only. No edits.

1. `at feedback show <id> --json`; read `text`, `agent`, `runId`, `context`, `log`.
2. If entry has `runId`: `at status <runId> -n 50` for the log.
3. Locate code via `codegraph_context` then one `codegraph_explore`. Check blast radius
   with `codegraph_impact` for anything you will change.
4. `note` with no actionable change → `at feedback resolve <id> --wontfix` → **REPORT**
   (`wontfix`). Otherwise → **TRIAGE**.

### State: TRIAGE

Classify **SMALL** or **COMPLEX** using the criteria in Rules. Log it:
`at feedback log <id> "triage: SMALL|COMPLEX — <why>" --state TRIAGE`.

- SMALL → skip PLAN, go **EXECUTE** / SubState `EDIT`.
- COMPLEX → **PLAN**.
- Unsure → COMPLEX.

### State: PLAN (COMPLEX only)

Read-only. Produce the plan:

- Smallest change that satisfies the entry; files + functions to touch.
- For `bug`: the failing vitest test to add first (exact file, assertion).
- Split into subtasks if >1 concern or >3 files; each must be self-contained.
- Pick tier: `-t 1` multi-file/design, `-t 2` default, `-t 3` boilerplate.
- Draft the delegation prompt(s) per `delegate-with-at` (explicit files, functions,
  constraints, goal, test framework, "no new dependencies", "do not commit").
- Every prompt for `at` must include this exact line for subagent self-direction:
  ```
  You are not alone, focus on your task, ignore other errors. Keep caveman/ultra-brief responses to user when
  reporting progress. Minimal texting, save tokens.
  ```
- Log the plan: `at feedback log <id> "plan: <short>" --state PLAN`.

Go **EXECUTE** / SubState `DELEGATE`.

### State: EXECUTE

#### SubState: EDIT (SMALL only)

1. For `bug`, add the failing test first and run it; confirm it fails.
2. Make the minimal change yourself; match surrounding style; no new dependencies.
3. Log: `at feedback log <id> "edit: <what>" --state EXECUTE --sub EDIT -o try -f <files>`.
4. Go **VERIFY**.

#### SubState: DELEGATE (COMPLEX only)

1. For `bug`, delegate the failing test first and confirm it fails
   (`npx vitest run <file>`), unless infeasible.
2. Launch. Short task (<~5 min): stream mode and block:
   `at -s -t <tier> -r 1 -p "<prompt>"`.
   Long task (refactor, multi-file): detached:
   `at -t <tier> -p "<prompt>"` and parse `Run ID` from the output.
3. Log: `at feedback log <id> "delegated: <task>" --state EXECUTE --sub DELEGATE -o try -r <runId>`.
4. Stream → **REVIEW**. Detached → **WAIT**.

#### SubState: WAIT (detached only)

1. `at status <runId> -n 20`. Status `running` → ⏸ end tick; re-enter with
   `ScheduleWakeup` (delay 270–600s) passing this same prompt. Do **not** busy-poll.
2. Status `stuck` (no log activity 30 min) → `at stop <runId> --force`, log `failed`
   (`--sub WAIT -o failed`), file
   `at feedback add "<agent> stuck on <task>" -k bug -a <agent> -r <runId>`, → **RETRY**.
3. `done` → **REVIEW**. `failed` → log `failed`, → **RETRY**.

#### SubState: REVIEW

Review, don't rewrite. Read the diff (`git diff -- <files>`), logs
(`at status <runId> -n 50`). Check against the plan: right files, minimal, style match,
no stray files, no commits, tests added. Wrong → log `failed` with what is wrong,
**RETRY**. Acceptable → log `ok` (`--sub REVIEW -f <files>`), **VERIFY**.

#### SubState: RETRY

- Attempts (≥3 `failed` in log) → give up: **CLOSE** with outcome `failed`.
- Else rewrite the prompt with what went wrong (error text, failing assertion), escalate
  tier by one (`-t 1` max) on the second retry → **DELEGATE**. Do not hand-patch COMPLEX
  work.
- SMALL work that failed VERIFY: fix it yourself → **EDIT**.
- If an `at` agent itself misbehaved (ignored flag, crash, bad output), file
  `at feedback add "<what happened>" -k bug -a <agent> -r <runId> --context "<error>"`
  so the loop can fix `at` later.

### State: VERIFY

All must pass:

- `npx tsc --noEmit`
- `npx vitest run <touched test files>`
- `npx vitest run tests/` (skip `tests_ai/`: needs real agent binaries, slow and flaky;
  failures clearly unrelated to your change may be ignored; say so)

Pass → **CLOSE** (`fixed`). Fail → log `failed` with output (`--state VERIFY -o failed`),
then **RETRY** (or **CLOSE** `failed` if exhausted).

### State: CLOSE

- `fixed`: `at feedback rm <id>` (removes the entry and its log); `done += 1`;
  `consecutiveFailures = 0`.
- `failed`: do not remove. Log the reason
  (`at feedback log <id> "gave up: <why>" --state CLOSE -o failed`). The 3rd failed item
  excludes the entry from POLL until the log TTL expires. `consecutiveFailures += 1`.

Go **REPORT**.

### State: REPORT

Print one line: `id | kind | SMALL|COMPLEX | fixed|failed|wontfix | files changed`.

- `consecutiveFailures >= 3` → **STOP** (`STOPPED AFTER FAILURES`).
- `done >= 5` this run → ⏸ end tick (`LIMIT REACHED`); the next tick continues.
- Caller asked for "once" → **STOP**.
- Else → **POLL**.

### State: STOP

Terminal. The loop is over; do not reschedule. Print exactly one signal:
`LOOP: QUEUE EMPTY` (no open or workable entries), `LOOP: STOPPED AFTER FAILURES`.

1. `CronList`, then `CronDelete` every job whose prompt references `LOOP.md`.
2. In dynamic mode, `ScheduleWakeup` with `stop: true`. Never pass `delaySeconds`.
3. Do **not** call `CronCreate` or schedule any wakeup.
4. Print `loop stopped — <signal>, removed cron ids: <ids|none>`, then end the turn with
   no further tool calls. A fixed-interval `/loop 30m` owned by the harness cannot be
   stopped from inside the agent; tell the user to cancel it (Ctrl+C / `/loop` cancel).
   Any tick that still fires hits POLL, finds nothing workable, and exits at once.

Resume by restarting `/loop LOOP.md` after new feedback is added.

## Safety

- Max 5 entries per tick; then stop the tick and report.
- Stop immediately after 3 consecutive failures.
- If the working tree contains changes unrelated to the entry you are fixing, leave
  them alone; do not stash or revert them.
- If interrupted mid-entry, leave the entry untouched in the queue; its `log` is the
  resume point for the next tick.
