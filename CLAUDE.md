# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working w/ code in this repo.

## Commands

```bash
npm run build        # tsc → dist/
npm run dev          # ts-node src/cli.ts (run without building)
npm test             # vitest run (all tests in tests/)
npm run test:watch   # vitest (watch mode)
npm run test:agents  # vitest run tests_ai/

# Run a single test file
npx vitest tests/resolver.test.ts

# Run the built CLI
node dist/cli.js -p "fix the bug"
```

## Architecture

`at` is thin CLI wrapper that routes coding prompt to one of many AI agent binaries via round-robin scheduling and retry.

```
src/cli.ts          parse flags + stdin → resolveFromArgs/parseJsonInput → run()
src/resolver.ts     normalise raw argv/JSON into a typed RunOptions struct
src/scheduler.ts    round-robin state: read/write /tmp/at-<tier>-state.json
src/runner.ts       spawn agent process (stream or detached), retry on non-zero exit
src/agents/registry.ts  AgentDef[] — name, tier, bin(), buildArgs(), buildEnv(), promptMode
```

**Flow:** CLI → Resolver → Runner → (Scheduler picks agent) → child process spawned

### Tiers

| Tier          | Agents                                    | Role                       |
|---------------|-------------------------------------------|----------------------------|
| 1             | glm-code, codex, kimi                     | architect / review         |
| 2 *(default)* | blackbox, mm-code, opencode, qwen, pi     | dev / QA                   |
| 3             | kilo, agy, goose, aider, cursor, cline | experimental / boilerplate |
| 4             | mock, mock-long                           | dry-run / test agents      |

### Key design points

- **Binary resolution:** Each `AgentDef.bin()` checks env override (e.g. `OPENCODE_BIN`) then falls back to `$NODE_BIN/<name>`  `$LOCAL_BIN/<name>`. `NODE_BIN` defaults to dir of running `node` binary (`path.dirname(process.execPath)`); `LOCAL_BIN` to `~/.local/bin`. Override via `env.local.sh` (gitignored).
- **promptMode:** Defaults to `'arg'` (prompt passed as CLI arg). Set to `'stdin'` (e.g. `agy`) to pipe prompt to child's stdin instead.
- **Detached mode (default):** Child is spawned detached; stdout/stderr go to `/tmp/at-logs/at-<timestamp>-<agent>.log`. Caller gets `[at] started <agent> (pid N) — logs: <path>` and blocks until child exits (enabling timeout, error detection, and retry).
- **Stream mode (`-s`):** Child output is streamed to terminal and simultaneously written to `/tmp/at-logs/at-<timestamp>-<agent>.log`.
- **Retry:** On non-zero exit, `runner` picks next agent in same tier and retries, up to `min(retries, candidates.length - 1)` additional attempts. Named agents (`-a <name>`) never retry.
- **Scheduler state:** `/tmp/at-<tier>-state.json` (or `/tmp/at-global-state.json` w/ `--global-state`). Shape: `{ index: number }`.
- **JSON mode (`--json`):** Reads `{ agent, prompt, model, cwd, env }` from stdin — compatible w/ existing `coding-agent` protocol.
- **`defaultSpawner` is injectable** in `runner.run()` for testing w/o real agent binaries.

### State locking

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

**Module:** `src/lock.ts` — exports `acquireLock` `releaseLock` `withLock`

### Adding an agent

Add new `AgentDef` entry to `AGENTS` in `src/agents/registry.ts`. Implement `bin()` `buildArgs()`and optionally `buildEnv()`  `promptMode`. No other files need changing.

