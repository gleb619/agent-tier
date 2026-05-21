# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run build        # tsc → dist/
npm run dev          # ts-node src/cli.ts (run without building)
npm test             # jest (all tests in tests/)
npm run test:watch   # jest --watch

# Run a single test file
npx jest tests/resolver.test.ts

# Run the built CLI
node dist/cli.js -p "fix the bug"
```

## Architecture

`at` is a thin CLI wrapper that routes a coding prompt to one of many AI agent binaries via round-robin scheduling and retry.

```
src/cli.ts          parse flags + stdin → resolveFromArgs/parseJsonInput → run()
src/resolver.ts     normalise raw argv/JSON into a typed RunOptions struct
src/scheduler.ts    round-robin state: read/write /tmp/at-<tier>-state.json
src/runner.ts       spawn agent process (stream or detached), retry on non-zero exit
src/agents/registry.ts  AgentDef[] — name, tier, bin(), buildArgs(), buildEnv(), promptMode
```

**Flow:** CLI → Resolver → Runner → (Scheduler picks agent) → child process spawned

### Tiers

| Tier | Agents | Role |
|------|--------|------|
| 1 | glm-code, codex, kimi | architect / review |
| 2 *(default)* | blackbox, opencode, qwen | dev / QA |
| 3 | kilo, gemini, goose, aider, pi | experimental / boilerplate |

### Key design points

- **Binary resolution:** Each `AgentDef.bin()` checks an env override (e.g. `OPENCODE_BIN`) then falls back to `$NODE_BIN/<name>` or `$LOCAL_BIN/<name>`. `NODE_BIN` defaults to `~/.nvm/versions/node/v22.20.0/bin`; `LOCAL_BIN` to `~/.local/bin`.
- **promptMode:** Defaults to `'arg'` (prompt passed as a CLI arg). Set to `'stdin'` (e.g. `gemini`) to pipe the prompt to the child's stdin instead.
- **Detached mode (default):** Child is spawned detached; stdout/stderr go to `/tmp/at-logs/at-<timestamp>-<agent>.log`. Caller gets `[at] started <agent> (pid N) — logs: <path>` and blocks until the child exits (enabling timeout, error detection, and retry).
- **Stream mode (`-s`):** Child output is streamed to the terminal and simultaneously written to `/tmp/at-logs/at-<timestamp>-<agent>.log`.
- **Retry:** On non-zero exit, `runner` picks the next agent in the same tier and retries, up to `min(retries, candidates.length - 1)` additional attempts. Named agents (`-a <name>`) never retry.
- **Scheduler state:** `/tmp/at-<tier>-state.json` (or `/tmp/at-global-state.json` with `--global-state`). Shape: `{ index: number }`.
- **JSON mode (`--json`):** Reads `{ agent, prompt, model, cwd, env }` from stdin — compatible with the existing `coding-agent` protocol.
- **`defaultSpawner` is injectable** in `runner.run()` for testing without real agent binaries.

### Adding an agent

Add a new `AgentDef` entry to `AGENTS` in `src/agents/registry.ts`. Implement `bin()`, `buildArgs()`, and optionally `buildEnv()` and `promptMode`. No other files need changing.
