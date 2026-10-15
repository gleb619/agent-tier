# Architecture

Detail doc for [README.md](../README.md) and [AGENTS.md](../AGENTS.md).

`at` is thin CLI wrapper that routes coding prompt to one of many AI agent binaries via round-robin scheduling and retry.

```
src/cli.ts          parse flags + stdin → resolveFromArgs/parseJsonInput → run()
src/resolver.ts     normalise raw argv/JSON into a typed RunOptions struct
src/scheduler.ts    round-robin state: read/write /tmp/at-<tier>-state.json
src/runner.ts       spawn agent process (stream or detached), retry on non-zero exit
src/naming.ts       applyRunName(): prompt + log tail → RunRecord.name, namer.lock-serialized, naming-queue.jsonl fallback (shared by runner + run-watch + status)
src/run-watch.ts    detached supervisor: poll pid, name run, finalise record, verify, callback
src/agents/registry.ts  AgentDef[] — name, tier, bin(), buildArgs(), buildEnv(), promptMode
src/agents/generic-loader.ts  discover plugins from ~/.at/*/generic.js
src/config.ts            load ~/.at/config.json with HMAC verification
src/atomic-write.ts      writeFileAtomic(Sync): temp file + same-dir rename (no half-written reads)
src/compose/task-source.ts   TaskSource iface (claim/onPhase/onFinish) + taskGoal() + plan-file keywords for external queues
src/compose/kanban-source.ts kanban-backed TaskSource: claim/finish the board via mutateBoard
src/feedback-store.ts  feedback.jsonl CRUD, autoclean, and file locking
src/commands/feedback.ts  `at feedback` subcommands: add, list, show, update, resolve, rm, clear, prune
src/notify/types.ts     NotifyEvent / NotifyAdapter iface
src/notify/index.ts     adapter registry + setupNotify()
src/notify/hub.ts       HTTP/SSE hub (/events, /emit, replay + live)
src/notify/store.ts     jsonl event persistence (readEvents/appendEvent)
src/notify/tailer.ts    log file tail → adapter.parseLine → hub.publish
src/notify/adapters/*   per-agent stream-json/--json/log adapters
```

**Flow:** CLI → Resolver → Runner → (Scheduler picks agent) → child process spawned

## Key design points

- **Binary resolution:** Each `AgentDef.bin()` checks env override (e.g. `OPENCODE_BIN`) then falls back to `$NODE_BIN/<name>`  `$LOCAL_BIN/<name>`. `NODE_BIN` defaults to dir of running `node` binary (`path.dirname(process.execPath)`); `LOCAL_BIN` to `~/.local/bin`. Override via `env.local.sh` (gitignored).
- **promptMode:** Defaults to `'arg'` (prompt passed as CLI arg). Set to `'stdin'` (supported for generic plugin agents) to pipe prompt to child's stdin instead.
- **Detached mode (default):** Child is spawned detached; stdout/stderr go to `/tmp/at-logs/at-<timestamp>-<agent>.log`. Caller gets the run box (runId, pid, log path) and returns immediately. A background supervisor (`src/run-watch.ts`) polls the pid, names the run (`src/naming.ts`, opt-in via `AT_NAME_RUN=1` — the CLI is already gone here, so the supervisor is the only process that can persist the name), marks the run `done` with `exitCode: null` (the real exit code of a non-child process is unknowable) and runs the `--callback` (`AT_EXIT_CODE=0`, plus `AT_RUN_NAME`). `--wait` (or `-s`) blocks until the child exits, enabling `--timeout`, retry, agent-health tracking, in-process naming and a callback with the real exit code.
- **Run naming (`src/naming.ts`):** Post-completion and reflective — the run is named only after it produced output, with the namer input being the original prompt plus a tail slice (`REFLECT_TAIL_BYTES`, 4 KB) of the run log (via `opts.context` on `generateSessionName`). Naming is serialized across concurrent `at` processes by a `namer.lock` file mutex (`src/lock.ts`, 120 s timeout); on lock timeout the job is appended to `<stateDir>/naming-queue.jsonl` and retried by `drainNamingQueue` — called at the start of `applyRunName`, from `run-watch.main()` and from `runStatus` (silent, so `--json` stderr stays clean). Never throws: failures leave `UNNAMED_PLACEHOLDER`.
- **Stream mode (`-s`):** Child output is streamed to terminal and simultaneously written to `/tmp/at-logs/at-<timestamp>-<agent>.log`.
- **Retry:** On non-zero exit, `runner` picks next agent in same tier and retries, up to `min(retries, candidates.length - 1)` additional attempts. Named agents (`-a <name>`) never retry. Retry only applies to `--wait` / `-s` runs — non-wait detached runs return immediately with no observable exit code.
- **`--verify <cmd>`:** Post-run shell hook fired after the agent exits and before `--callback`. Non-zero exit fails the run (status `failed`, log line, callback still fires with `AT_STATUS=failed`); in blocking modes the runner raises `AgentError('verify failed …')` so the existing retry-with-next-agent loop applies. The detached supervisor receives the command via `AT_VERIFY_CMD` env (no argv extension) and runs it in `AT_CWD` (`options.cwd`) when set, else its own cwd.
- **Scheduler state:** Per-tier round-robin index in the `scheduler` section of `<stateDir>/state.json` (project `.at/` when present, else `~/.at/`). Shape: `{ "tier-2": { index } }`.
- **Prompt file (`-f, --prompt-file`):** Reads the prompt from a file — `.md` raw text; `.json` parsed, using its top-level `prompt` string field when present, raw contents otherwise.
- **JSON mode (`--json`):** Reads `{ agent, prompt, promptFile, model, cwd, env, callback, verify, sse, ssePort }` from stdin — compatible w/ existing `coding-agent` protocol.
- **`defaultSpawner` is injectable** in `runner.run()` for testing w/o real agent binaries.

## State locking

All write operations on shared state files use file-based mutex to prevent TOCTOU races when multiple `at` processes run concurrently.

**Lock dir:** `~/.at/locks/`

**Lock file naming:** state file path → lowercase, replace `/`  `.` w/ `-`append `.lock`
  Example: `/home/user/.at/state.json` → `~/.at/locks/home-user--at-state-json.lock`

**Lock file content:**
```json
{ "pid": 12345, "hostname": "my-host", "startedAt": "2026-...", "stateFile": "/path/to/state.json" }
```

**Stale lock detection:** if PID in lock file is no longer alive (`process.kill(pid, 0)` throws), lock is stolen and retried immediately.

**Locked operations:**
- `pickAgent()` in `scheduler.ts` — round-robin index read→increment→write
- `recordResult()` `setDeactivated()` `resetAgent()` in `health.ts` — agent health read→modify→write
- `addRun()` `updateRun()` `pruneRuns()` in `run-store.ts` — runs index read→modify→write
- `mutateBoard()` in `kanban/board.ts` — whole-board read→mutate→write (used by every `at kanban`
  mutating op and by compose's kanban source claim/finish)
- `saveState()` in `compose/state.ts` — compose `state.json` write per phase transition

## Locking & atomic writes

Three shared files are protected, all via `src/lock.ts` (`withLock` file mutex, stale-lock steal):

| What | Locked by | Written via |
|------|-----------|-------------|
| runs / scheduler / health state (`<stateDir>/`) | `lock.ts` per file | `src/atomic-write.ts` where applicable |
| kanban board (`docs/kanban.md`) | `mutateBoard` → `withLock` | `writeFileAtomicSync` (temp + rename) |
| compose `state.json` (`~/.at/compose/<id>/`) | `saveState` → `withLock` | `ComposeWorkspace.write` → `writeFileAtomic` |

`src/atomic-write.ts` lands content in a sibling temp file, then a same-directory rename swaps it
in — a reader never sees a half-written file, and a crash mid-write leaves only the temp file.

**Module:** `src/lock.ts` — exports `acquireLock` `releaseLock` `withLock`

## Bridge + proxy (`docs/bridge.md`, `web-server/`)

`at bridge <resource> <verb> [id]` is the JSON-in/JSON-out RPC surface (docs/bridge.md). Every resource (`ping`, `agents`, `runs`, `status`, `feedback`, `kanban`, `config`, `line`, `events`, `discuss`, `health`) exposes thin handlers (`src/bridge/*.ts`) over existing stores. Success: `{"ok":true,"data":...}`; error: `{"error":{"code":"USAGE|NOT_FOUND|...","message":"..."}}` with exit codes `0` (ok), `2` (usage), `3` (application).

The Go server (`web-server/internal/proxy`) is a thin HTTP+static+SSE proxy: it translates REST requests into `at bridge` executions (`Call` in `bridge.go`), maps envelope machine codes to HTTP status (`HTTPStatus`), and falls back to direct `at` shims for endpoints with no bridge verb yet (`run` spawn, settings). The binary is resolved via `AT_BIN` (defaults to `at`). The proxy never reads or writes state files directly; the CLI bridge remains the source of truth.

## Adding an agent

Add new `AgentDef` entry to `AGENTS` in `src/agents/registry.ts`. Implement `bin()` `buildArgs()`and optionally `buildEnv()`  `promptMode`. No other files need changing.
