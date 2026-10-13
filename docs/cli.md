# CLI usage

Detail doc for the flags in [README.md](../README.md).

## Sending prompts

Four ways to pass a prompt:

```bash
# Flag
at -p "fix the login bug"

# Stdin pipe
echo "fix the login bug" | at

# Prompt file (-f): .md is read as raw text; .json uses its top-level `prompt`
# string field, falling back to the raw file contents
at -f prompts/fix-login.md

# JSON mode
echo '{"agent":"opencode","prompt":"fix the login bug"}' | at --json
```

Precedence when several are given: an explicit source always wins over a
missing one — stdin pipe > `-f` file > `-p` text (non-JSON mode). In JSON mode:
JSON `prompt` > JSON `promptFile` > `-f` file > `-p` text.

## Output modes

| Mode               | Behavior                                                                                                                                                  |
|--------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------|
| Detached (default) | Agent spawns in the background; `at` prints the run box (runId, pid, log path) and returns immediately. A background supervisor (`src/run-watch.ts`) names the run, marks it done (`exitCode: null`) and runs `--callback`. |
| Detached `--wait`  | Same as detached, but blocks until the agent exits. Enables `--timeout`, retry, agent-health tracking and a callback with the real exit code.              |
| Stream (`-s`)      | Agent output is streamed to the terminal and simultaneously written to a log file. Blocks until the agent exits.                                          |
| SSE (`--sse`)      | Live progress streamed over HTTP/SSE. See [Live progress (SSE)](progress.md#live-progress-sse).                                                                       |

## Retry behavior

When an agent exits non-zero, `at` automatically picks the next agent in the same tier and retries, up to
`min(retries, candidates.length - 1)` additional attempts. Named agents (`-a <name>`) never retry.

## Other flags

| Flag | Behavior |
|------|----------|
| `-f, --prompt-file <path>` | Read the prompt from a file — `.md` raw text, `.json` uses its `prompt` field |
| `-m, --model <name>` | Pass a model name to the agent (agent-specific: arg and/or env) |
| `--timeout <ms>` | Force-kill the agent after N ms (default: 1800000 = 30m) |
| `--no-chop` | Disable chop output-log compression in stream mode (default: enabled when chop is available) |
| `--state-dir <path>` | Override the state directory (default: `.at/` in CWD if it exists, else `~/.at/`) |
| `--sse [port]` | Live-progress SSE hub, default port 7777, `0` = random (see [progress.md](progress.md)) |
| `--global-prompt <text>` | Global prompt text prepended to every run's prompt |

## Global JSON defaults

Set default values for JSON mode (`at --json`) in `~/.at/config.json` under `"jsonDefaults"`:

```json
{
  "jsonDefaults": {
    "agent": "opencode",
    "model": "gpt-4o",
    "cwd": "/path/to/repo",
    "env": { "NODE_ENV": "production" }
  }
}
```

These defaults are merged into the stdin JSON on every `--json` invocation. Fields present in the per-invocation JSON override the config defaults. The `env` object is deep-merged (config provides base, stdin overrides specific keys).

Example — only pass the prompt in JSON, rest comes from config:

```bash
echo '{"prompt":"fix the login bug"}' | at --json
```

## Global prompt

Set a reusable global prompt in `~/.at/config.json` as `"globalPrompt": "your instructions here"`. It is
prepended (with a blank line) to every run's prompt before sending it to the agent. Override it per-run with
`--global-prompt`.

In JSON mode (`--json`), the JSON `globalPrompt` field and `--global-prompt` also work, with precedence:
CLI `--global-prompt` > JSON `globalPrompt` > config `globalPrompt`.

## Post-run verification hook

`--verify <command>` runs a shell command **after** the agent exits and **before** `--callback`.
A non-zero exit fails the run: the run record flips to `status: failed`, a line is appended to the run log
(`[at] verify failed (exit N): <cmd>` plus the first lines of its output), `--callback` still fires with
`AT_STATUS=failed`, and in blocking modes (`-s` / `--wait`) `at` raises `AgentError('verify failed …')`
so the existing retry-with-next-agent loop applies (a verify failure is treated like an agent failure for
retry purposes).

Use it to fail a run when an agent finishes but leaves the worktree broken — e.g. uncommitted formatting,
uncompiled TypeScript, missing migrations:

```bash
at -s -p "implement the new feature" --verify 'npx tsc --noEmit && npx eslint src'
# detached: AT_VERIFY_CMD env travels to the run-watch supervisor so the same hook fires
at -p "implement the new feature" --verify 'npx tsc --noEmit'
```

The verify command runs in the agent's working directory (`--cwd` when set, else `process.cwd()` for
detached supervisor runs). It receives the same `AT_*` env contract as `--callback` (runId, agent, tier,
exit code, log path, prompt, status) so it can react to agent failures the same way.

## JSON mode

Accepts a JSON object from stdin, compatible with the `coding-agent` protocol:

```json
{
  "agent": "opencode",
  "prompt": "add pagination to the users endpoint",
  "model": "gpt-4o",
  "cwd": "/path/to/repo",
  "env": { "SOME_VAR": "value" }
}
```

All fields except `prompt` are optional. Extra fields: `promptFile` (path, used
when `prompt` is absent), `callback` and `verify` (shell commands, same contract
as the flags), `sse` (boolean) and `ssePort` (number, `0` = random).

## Compose (plan → implement → check)

`at compose` runs one goal through a fixed state machine instead of a single agent call.
Tier 1 plans and judges; tier 2 only implements.

```bash
at compose -p "add retry to the resolver" --test-cmd 'npm test'
at compose --goal "..." --max-rounds 5 --max-nodes 40
at compose -p "..." --resume <goalId>     # continue a saved run
at compose --task T7                      # compose one kanban task (claims it)
at compose --loop --stop-on-fail          # drain the board until nothing is executable
```

### Flags

| Flag                   | Behavior                                                                                                      |
|------------------------|---------------------------------------------------------------------------------------------------------------|
| `-p, --prompt` / `--goal` | Goal text. Required unless `--task`/`--loop` (mutually exclusive with them).                                |
| `--task <id>`          | Compose one kanban task by id: claims it (`Backlog` → `In Progress`) first. Unknown id → exit 1.              |
| `--loop`               | Claim + compose board tasks until no executable task remains (per-task: DONE → skip, FAILED → Blocked).       |
| `--board <file>`       | Board file for `--task`/`--loop` (default: resolved project board — see [kanban.md](kanban.md)).              |
| `--stop-on-fail`       | With `--loop`: stop after the first FAILED run (default: mark Blocked, keep going).                           |
| `--max-questions <n>`  | Max brain answers per agent run during IMPLEMENT (default 5) — see [progress.md](progress.md#brain--hands-m2m-discuss). |
| `--test-cmd <cmd>`     | Test command run during CHECK (default `npm test`).                                                           |
| `--max-rounds <n>`     | Re-plan rounds before FAILED (default 3).                                                                     |
| `--max-nodes <n>`      | Max codegraph nodes in the PLAN context (default 30).                                                         |
| `--resume <id>`        | Resume a saved goal by id (continues from its `state.json`).                                                   |

### State machine

```
              FAIL verdict, round < --max-rounds
   ┌────────────────────────────────────────────┐
   │                                            │
   ▼                                            │
INVESTIGATE ──► PLAN ──► IMPLEMENT ──► CHECK ───┼──► DONE (exit 0)
                                │               │
                                │               ├──► FAILED (exit 1): FAIL verdict at round >= max-rounds
                                │               └──► FAILED (exit 1): test exit != 0 forces verdict FAIL
                                └─ IMPLEMENT agent non-zero exit → abort (exit 1)
```

- **INVESTIGATE** — `at index init` when `.codegraph` is missing, then `at index sync`; codegraph
  context → `context.md`.
- **PLAN** — tier 1 writes `plan.md`: requirements, design notes, `- [ ] N. task` checklist. On
  re-plan (round > 1) the previous `verdict.md` findings are attached and the plan is append-only.
- **IMPLEMENT** — tier 2 per unchecked task, ticked on exit 0, first failure stops the run. Each
  question the implementer asks on the discuss channel is answered by the tier-1 brain (capped by
  `--max-questions`).
- **CHECK** — runs `--test-cmd` and `git diff` locally, then tier 1 reads the plan, test tail and
  diff and writes `verdict.md` (first line `PASS` or `FAIL`; anything else counts as `FAIL`).
  **A non-zero test exit forces `FAIL`** even when tier 1 wrote `PASS` — the orchestrator rewrites
  the verdict line and appends a note. `PASS` → `DONE`; `FAIL` re-plans (round + 1); rounds
  exhausted → `FAILED`.

### Detached runs + resume

Agent calls are detached (`at -t <tier> --state-dir <dir> -p <prompt>`, no `-s`); compose polls
`runs.jsonl` every 2 s (`waitRun`) and answers discuss questions while a run is in flight. Before
spawning a tier-2 implementer, its runId is persisted into `state.json`
(`runs: [{ phase, item, runId }]`), so a crashed compose **reattaches to the in-flight run** instead
of spawning a duplicate; the entry is dropped once the run finishes.

Resume: `--resume <id>` (or `--task <id>`, where **goalId = lowercase task id**) reloads
`~/.at/compose/<id>/state.json` and continues from the saved phase. A terminal `state.json`
(`DONE`/`FAILED`) is never re-run — the board task is just re-finalized.

Board claims take a **per-task lease**: a `src/lock.ts` pid lock under `<boardDir>/locks/` keyed by board
path + task id, held until the run finalizes. `--loop` therefore resumes the first **unleased** `In Progress`
task (crashed or human-marked) before starting new `Backlog` work, and skips rows leased by a live pid, so two
claimers never share a task. `--task <id>` on a leased task warns (`task T7 is claimed by pid N`) and exits 1.

### Artifacts, state, exit codes

Artifacts and `state.json` (`{ goal, state, round, testCmd, maxRounds, runs? }`, saved under the
state-file lock after every transition) live in `~/.at/compose/<goalId>/`. Exit code: **0** when the
goal reaches `DONE` (or a `--loop` finished with no task FAILED); **1** otherwise — `ComposeError`
(abort named after the failing phase: missing `plan.md`/`verdict.md`, non-zero agent exit), corrupt
`state.json`, unknown `--task <id>`, or any FAILED task under `--loop`.

Board integration (status mapping, locking, human edits) is described in
[kanban.md](kanban.md#compose--kanban); the brain↔hands discuss channel in
[progress.md](progress.md#brain--hands-m2m-discuss).

## Kanban board (`at kanban`)

`docs/kanban.md` is a Markdown table that agents use as a shared task board. The CLI is the only
sanctioned mutator: it parses to an mdast, edits the table node, and re-stringifies, so column
padding and pipe escaping stay correct and hand-editing is never required.

Board resolution: `[file]` positional → `--board <path>` → `$AT_KANBAN_FILE` → `<git root>/docs/kanban.md`.
Every subcommand takes `--json`; `lint` exits 1 on violations and `guard` exits 1 on a dropped ID.

```bash
at kanban init [file] [--force]          # scaffold legend + empty 9-column table
at kanban list [file]                    # ID / Status / Priority / Title (Blocked By)
at kanban next [file] [--start]          # pick work; --start marks it In Progress
at kanban show <id> [file] [--with-plan] # field block + first 100 lines of the plan file
at kanban add [file] [--id T7] --title "..." [--priority High|Medium|Low] [--owner o]
                     [--blocks ids] [--blocked-by ids] [--plan path] [--description text]
at kanban status <id> <status> [file]    # vocabulary comes from the board's own legend
at kanban remove <id> [file]             # alias: rm
at kanban clean [file]                   # drop every Done row
at kanban lint [file] [--root path]      # column count, unique IDs, legend statuses, plan files
at kanban guard <base> [--board rel]     # append-only history check
```

**Selection** (`next`) is a pure, totally-ordered function: an `In Progress` row always wins and is
returned as `type: "current"`, so an interrupted loop resumes instead of starting fresh and `--start`
is then a no-op. Otherwise the highest-priority unblocked `Backlog` row wins, ties broken by lowest
*numeric* ID. A task is blocked when any `Blocked By` ID exists on the board and is not `Done`;
unknown IDs are ignored. `Blocked` rows are never selected. No candidate prints
`No executable task found.` — a STOP signal, not an error.

**`add` is an idempotent upsert.** With an existing ID it changes only the flags you passed and never
touches `Status`; new rows are inserted in numeric-ID order (not appended) and get `Backlog` / `Low` /
`loop` / `-` defaults. A `--description` over 128 code points is trimmed to 125 plus `...` with a
warning on stderr — over-long input degrades, it never errors.

**Schema:** `ID` (`T<integer>`, unique), `Status` (from the legend table), `Title`, `Description`
(≤128), `Priority` (`High`/`Medium`/`Low`), `Owner`, `Blocks` (advisory only), `Blocked By` (what
selection actually reads), `Plan File` (path or `-`). Optional cells use the `-` sentinel, never
empty. The Status Legend table *is* the status vocabulary — add a status by editing the legend and
both `status` and `lint` accept it with no code change.

**`guard <base>`** compares the ID *set* at `<base>` against HEAD, so it is immune to re-padding
churn. A dropped ID fails unless some commit in `<base>..HEAD` carries a `[kanban-rewrite]` trailer,
which is the deliberate-rewrite audit trail. A missing base blob (base predates the board) passes.
In CI, check out with `fetch-depth: 0` and run it on `pull_request` before any build step:

```yaml
- run: node dist/cli.js kanban guard "${{ github.event.pull_request.base.sha }}"
```

**Concurrency:** every mutating op (`next --start`, `add`, `status`, `remove`, `clean`, and compose
claims/finishes) runs through `mutateBoard` — load → mutate → save under the kanban file lock, with
the write landed atomically (temp file + same-dir rename, `src/atomic-write.ts`). Concurrent `at`
processes serialize instead of clobbering; a human editing the file by hand mid-rewrite can still
race (last writer wins), so prefer `at kanban` even for manual tweaks.

## TUI

`at` with no arguments on a TTY starts the interactive TUI (requires Bun). It is a menu-driven
two-column layout (sidebar + one active view) implemented in `src/tui/`:

```bash
at          # TUI on a TTY
```

Views: **Dashboard** (run counters, active runs, recent completions, agent health), **New Task**
(prompt textarea + tier/agent/mode/retries selectors), **Run Details** (session metadata, log
viewer, submitted-prompt toggle), **Settings** (default tier/agent/mode/retries, auto-refresh).

| Key | Action |
|-----|--------|
| `1`–`4` | Dashboard / New Task / Run Details / Settings |
| `Tab` / `Shift+Tab` | cycle focus between filter, run list, and the active view |
| `j` / `k`, `↑` / `↓` | next/previous run (run list) or scroll (log pane) |
| `J` / `K` | next/previous run while the log pane is focused |
| `Enter` | open the selected run; submit the prompt while editing it |
| `p` / `Ctrl+P` | toggle the run's original prompt |
| `Ctrl+T` `Ctrl+A` `Ctrl+O` `Ctrl+N` | cycle tier / agent / mode / retries |
| `Ctrl+K` / `r` | kill / retry the selected run |
| `Ctrl+R` | refresh runs and log |
| `Ctrl+Q` / `q` | quit (`Esc` only leaves a text field) |

Stores (`src/tui/store/`) own the run list, log, settings, sidebar filter and focus zone; prompt
submission goes through `src/tui/launch.ts`. The TUI entry module is `src/tui-entry.ts`.


## Safety limits (laptop protection)

`at` refuses to start a run, and kills runaway ones, so a bad agent can't freeze the machine (`src/safety.ts`):

| Env | Default | Effect |
| :-- | :------ | :----- |
| `AT_MAX_CONCURRENT` | 3 | refuse to start when this many runs are already running |
| `AT_MIN_AVAIL_MB` | 3072 | refuse to start below this much available RAM |
| `AT_MAX_START_TEMP_C` | 80 | refuse to start when any thermal zone is this hot |
| `AT_MAX_LOAD_PER_CPU` | 1.5 | refuse to start when 1-min load > cpus × this |
| `AT_MAX_RSS_MB` | 6144 | SIGKILL an agent's process group above this RSS (tree total) |
| `AT_MAX_RUN_MS` | 3600000 | max runtime for detached runs (blocking runs use `--timeout`, default 30m) |
| `AT_SAFETY=off` | | disable all of the above (not advised) |

Outside `at`: `scripts/resource-guard.py` (systemd user service, `scripts/install-guard.sh`) pauses/kills any agent-tier process tree on high CPU/RAM/temperature, and `scripts/at-safe.sh <cmd>` runs a command with CPU affinity (4 of 8 cores), nice+ionice, task cap and wall-clock timeout (this host is cgroup v1: RAM is enforced by the guard + `AT_MAX_RSS_MB`, not cgroups).
