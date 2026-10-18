---
inclusion: always
---

# Architecture

## Data flow

```
CLI (src/cli.ts)
  → Resolver (src/resolver.ts)      flags/stdin/file/--json → RunOptions
  → Runner (src/runner.ts)          spawn, stream/detach, retry, verify hook
      → Scheduler (src/scheduler.ts)  round-robin within tier or line queue
          → Agent binary               child process (stream | detached)
              → RunWatch (src/run-watch.ts)  poll pid, mark done, --callback
```

## Source map

| Path | What lives here |
|---|---|
| `src/cli.ts` | Commander setup, no-arg TUI spawn |
| `src/resolver.ts` | Prompt resolution (flags, stdin, `-f`, `--json`) |
| `src/runner.ts` | Agent spawn, stream/detach modes, retry, `--sandbox`, `--verify` |
| `src/run-watch.ts` | Detached-run supervisor: polls pid, fires callback, calls namer |
| `src/scheduler.ts` | Round-robin state per mode (`tier-N` or `line`) in `.at/state.json` |
| `src/agents/registry.ts` | 14 built-in agent definitions: tier, bin(), buildArgs(), buildEnv(), promptMode |
| `src/agents/generic-loader.ts` | Drop-in `~/.at/<name>/generic.js` plugin agents |
| `src/health.ts` | Agent failure tracking, auto-deactivate, `at enable`/`at disable` |
| `src/run-store.ts` | `runs.jsonl` CRUD, stuck detection |
| `src/lock.ts` | File-based mutex with stale-lock steal |
| `src/config.ts` | `~/.at/config.json`, `tierOverrides`, HMAC tamper detection |
| `src/state-dir.ts` | `.at/` resolution logic |
| `src/notify/hub.ts` | SSE hub: `/events`, `/emit`, replay buffer |
| `src/notify/index.ts` | Per-agent output → structured events |
| `src/notify/adapters/` | Agent-specific log parsers (claude, codex, cline, opencode, kilo, kimi, pi, qwen, kiro) |
| `src/notify/discuss-store.ts` | Discuss channel (m2m ask/answer/note) |
| `src/chop.ts` | Stream log filtering + ChopLogger batch compression |
| `src/feedback-store.ts` | `feedback.jsonl` CRUD with file locking |
| `src/namer/` | LLM run naming (ollama/openrouter), lock-serialized, drain queue |
| `src/naming.ts` | Post-run naming orchestration |
| `src/triage/` | Free heuristic + model-refined routing (`at triage`) |
| `src/compose/` | Orchestration: single / plan-then-do / kanban loop |
| `src/compose/machine.ts` | Compose state machine |
| `src/compose/kanban-source.ts` | Kanban board adapter for compose loop |
| `src/kanban/` | Markdown kanban board (AST mutations, not regex) |
| `src/usage/` | Token/time metrics per run |
| `src/bridge/` | WebUI ↔ backend data bridge (REST endpoints) |
| `src/tui/` | opentui/solid TUI — Bun-only, two-column menu |
| `src/webui/` | Svelte 5 PWA (pnpm workspace member) |
| `web-server/` | Go REST+SSE backend (`at-web`), proxy, static |
| `mock-agent/` | Tier-4 Go mock binaries; `#NORMKA` step spec triggers |
| `src/mcp/` | MCP stdio server: `run_prompt`, `list_agents`, `get_status` |
| `src/init/` | `at init` — wrapper scripts for built-in agents |
| `src/commands/` | One file per `at <subcommand>` |
| `scripts/` | CI, worktree, test-guard, build helpers |
| `tests/` | Unit suite (vitest); no real agents |
| `tests_ai/` | Live agent suite (opt-in, `AT_LIVE_AGENTS=1`) |
| `docs/` | Long-form docs: cli, architecture, kanban, agents, webui, progress |

## Tiers

| Tier | Agents | Role |
|---|---|---|
| 1 | glm-code, codex, kimi | architect / review |
| 2 *(default)* | mm-code, opencode, qwen, cline | dev / QA |
| 3 | kilo, agy, kiro, devin, pi | experimental / boilerplate |
| 4 | mock, mock-long | dry-run / test |

## Scheduling modes

| Mode | Selected by | Behavior |
|---|---|---|
| tier | `-t <N>` | Round-robin within that tier |
| line | no `-t` (default) | All agents in one ordered queue; default t3→t2→t1, mocks excluded |

Line order stored in `~/.at/config.json` (`"line": [...]`, HMAC-signed).  
Manage with `at line add|rm|move|show`.  
Separate round-robin key per mode: `tier-N` vs `line`.

## Key design points

- **State locking** — `src/lock.ts` file mutex with stale-lock steal prevents concurrent `at` processes from corrupting `state.json` / `runs.jsonl`.
- **Retry with next-in-tier** — `--retries N` picks the next scheduled agent on non-zero exit; named agents (`-a <name>`) never retry.
- **Run history** — `runs.jsonl` CRUD + stuck detection; `at status` / `at stop` surface this.
- **Agent health** — failure counters auto-deactivate agents; `at enable/disable` for manual control.
- **Config HMAC** — `~/.at/config.json` is tamper-evident; always run `at config sign` after manual edits.
- **Compose** — `at compose` is the high-level orchestrator. `--plan-then-do` switches to arch→dev→review pipeline. `--board <file>` + `--loop` drives kanban tasks. `--worktree` runs each task in an isolated worktree.
- **Discuss channel** — `AT_DISCUSS=1` enables blocking m2m ask/answer/note between agent and orchestrator via SSE store.
- **Output chop** — stream logs compressed via external `chop` binary (`~/.at/chop`); raw passthrough if unavailable.
- **Session naming** — LLM names runs post-completion via `src/namer/`; detached runs named by supervisor; queue drained by `applyRunName`.

## Adding a new built-in agent

1. Add entry in `src/agents/registry.ts` (tier, bin, buildArgs, buildEnv, promptMode).
2. Add notify adapter in `src/notify/adapters/<name>.ts` if the agent has structured log output.
3. Register adapter in `src/notify/index.ts`.
4. Add live test in `tests_ai/<name>.test.ts`.
5. Run guardrails before merging.
