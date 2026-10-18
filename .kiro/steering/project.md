---
inclusion: always
---

# Project: agent-tier (`at`)

Thin CLI that routes a coding prompt to one of many AI agent binaries via round-robin scheduling and automatic retry.

## Stack

| Layer | Tech |
|---|---|
| Runtime | Node.js (dist), Bun (TUI + bin compile) |
| Language | TypeScript 5, strict |
| Package manager | pnpm 9 (workspace: root + `src/webui`) |
| Linter/formatter | Biome (`biome.json`) — no ESLint/Prettier |
| Test runner | Vitest 3 |
| Web backend | Go (`web-server/`, binary `bin/at-web`) |
| WebUI | Vite + Svelte 5 + Tailwind (`src/webui/`) |
| Mock agents | Go binaries (`mock-agent/`, `bin/mock-agent`, `bin/mock-long-agent`) |
| Container | multi-stage `Dockerfile` |

## Key conventions

- **2-space indent, double quotes, semicolons, 120-char line width** (Biome)
- `import` order managed by Biome `organizeImports` — do not manually reorder
- Suppress false positives with `// biome-ignore lint/<rule>: reason`; a11y rules are already off for `src/tui/**` (opentui, not DOM)
- `src/cli.ts` is the entry point; after editing it rebuild `bin/at` via `bun build --compile src/cli.ts --outfile bin/at` (`~/.local/bin/at` wrapper goes stale otherwise)
- State directory: `.at/` in CWD if it exists, else `~/.at/`
- Config file: `~/.at/config.json` (HMAC-signed; use `at config sign` after manual edits)
- Never add `Co-Authored-By` or similar AI-attribution trailers to commits
- Never `git stash` / `git reset` without explicit user approval

## Important files

| File | Purpose |
|---|---|
| `src/cli.ts` | Entry: commander setup, TUI spawn |
| `src/resolver.ts` | Flag/stdin/file/json → `RunOptions` |
| `src/runner.ts` | Spawn agent, stream/detach, retry |
| `src/scheduler.ts` | Round-robin per tier/line, state in `.at/state.json` |
| `src/agents/registry.ts` | 14 built-in agents: tier, bin, args, env, promptMode |
| `src/commands/` | One file per `at <subcommand>` |
| `src/compose/` | Orchestration (single / plan-then-do / kanban loop) |
| `src/tui/` | opentui/solid TUI (Bun-only) |
| `src/webui/` | Svelte 5 PWA (pnpm workspace member) |
| `web-server/` | Go REST+SSE backend for WebUI |
| `scripts/` | CI, worktree helpers, test-guard |
| `AGENTS.md` | Primary agent/workflow reference (read first) |
