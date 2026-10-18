---
inclusion: always
---

# Testing

## Test suites

| Suite | Path | Command | Notes |
|---|---|---|---|
| Unit (default) | `tests/**` | `pnpm test` / `npx vitest run` | No real agents. Always run. |
| Live/AI | `tests_ai/**` | `pnpm run test:agents` | Requires `AT_LIVE_AGENTS=1`. Burns real agent quota. Opt-in only. |
| All | unit + live | `pnpm run test:all` | Costly. |
| Guard | meta-check | `pnpm run test:guard` | Verifies default test path stays unit-only. |
| E2E (WebUI) | `tests/e2e/**` | `pnpm run test:e2e` | Playwright; needs browser binaries. |

## Commands

```bash
pnpm test                          # unit suite
pnpm run test:watch                # watch mode
npx vitest tests/runner.test.ts    # single file
pnpm run test:guard                # CI unit-only gate
pnpm run test:agents               # live suite (AT_LIVE_AGENTS=1) — explicit only
pnpm run test:all                  # unit + live (costly)
pnpm run test:coverage             # coverage report
```

## Guardrail order (before merging)

```bash
pnpm exec biome ci .    # lint + format
npx tsc --noEmit        # type-check
npx vitest run          # unit suite
```

All three must pass. Do not skip any. Fix failures in the same branch.

## Test guard rules

- `tests/` — unit tests only; no real agent spawns, no network, no `AT_LIVE_AGENTS`.
- `tests_ai/` — live tests; gated by `AT_LIVE_AGENTS=1`; never run in CI by default.
- `scripts/test-guard.sh check` enforces that `vitest run` (no config override) runs only `tests/**`.
- Orphan process check: `pnpm run test:orphans` (lists stale `dist/cli.js -s -a` processes for this worktree).

## Test structure

```
tests/
  *.test.ts          # top-level unit tests (runner, resolver, scheduler, etc.)
  agents/            # agent registry tests
  commands/          # per-subcommand tests
  compose/           # compose machine / kanban-source / worktree tests
  kanban/            # kanban AST ops, parse, lint, guard
  mcp/               # MCP server
  namer/             # session namer config/orchestrator/providers
  notify/            # SSE hub, adapters, discuss channel
  tui/               # TUI component / store / layout tests
  usage/             # token+time metrics
  e2e/               # Playwright / normka integration

tests_ai/
  *.test.ts          # one file per built-in agent
  live-setup.ts      # shared setup
  live.ts            # live test utilities
```

## Adding tests for a new feature

1. Unit tests go in `tests/<area>/` or `tests/<name>.test.ts`.
2. For a new built-in agent, add `tests_ai/<name>.test.ts` (live only).
3. Mocks: use `vi.mock` / temp directories / the mock agents (`bin/mock-agent`, `bin/mock-long-agent`) — never spawn real agents in unit tests.
4. Run `pnpm run test:guard` to confirm the unit path is still clean.
