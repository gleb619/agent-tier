# Normka Mock Agents — Design Spec

**Date:** 2026-10-10
**Status:** Approved
**Scope:** `src/agents/registry.ts` + new Go binary (`bin/mock-agent`, `bin/mock-long-agent`)

## Goal

Replace the bash `bin/mock-agent` placeholder with a real Go binary that supports a "normka mode". When a triggering token is present, the binary parses a JSON instruction spec from the prompt and executes one or more typed steps (file write, HTTP request, SSE tail, `at discuss` call, lorem-ipsum generation). When no trigger is present, behaviour matches the legacy shell mocks (stream mock output for `mock-long`, echo for `mock`).

## Triggers (OR — any one activates normka)

1. CLI flag `--normka` in `os.Args`.
2. First non-blank line of prompt equals `#NORMKA` (case-insensitive, leading/trailing whitespace trimmed).
3. First ```json fenced block contains a line `// normka:on` (magic TS-style comment).

When activated: trigger envelope stripped → remaining text is parsed as the JSON spec below. Else: legacy behaviour.

## JSON spec (versioned)

```json
{
  "version": 1,
  "name": "demo",
  "duration_ms": 5000,
  "steps": [
    { "kind": "lorem", "paragraphs": 5 },
    { "kind": "file", "path": "/tmp/x.txt", "content": "hello\n" },
    { "kind": "http", "method": "GET", "url": "https://example.com", "expect": [200, 201] },
    { "kind": "sse", "url": "http://localhost:8080/events", "events": 10, "timeout_ms": 8000 },
    { "kind": "discuss", "ask": "ops", "question": "ack?", "answer_after_ms": 1000 }
  ]
}
```

- `version` mandatory; mismatch → exit 2.
- Unknown `kind` → exit 2.
- `duration_ms` only consumed by `mock-long-agent` (overrides `MOCK_LONG_DURATION`).
- Empty `steps` → exit 0 (no-op success).

## Executor

`mock-agent/internal/executor/`:

| File          | Step kind  | Behaviour                                                                 |
|---------------|-----------|---------------------------------------------------------------------------|
| `lorem.go`    | `lorem`   | Emit N paragraphs of lorem ipsum text to stdout.                         |
| `file.go`     | `file`    | Write `content` to `path` (creates parent dirs).                          |
| `http.go`     | `http`    | Method + URL → response. Status in `expect` (or `2xx` default) → pass.   |
| `sse.go`      | `sse`     | Stream SSE, count `events` or hit `timeout_ms` first.                     |
| `discuss.go`  | `discuss` | POST `{ask, question}` to `AT_DISCUSS_URL` (default `http://127.0.0.1:8787/ask`), poll until answer or timeout. |
| `dispatch.go` | —         | `map[string]Handler` registry.                                            |

Each step emits two JSON lines on stdout:

```
{"ts":"...","step":1,"kind":"http","status":"start","detail":"..."}
{"ts":"...","step":1,"kind":"http","status":"end","ok":true,"elapsed_ms":42}
```

`ok:false` or panic in handler → exit 3 with step index on stderr.

## Exit codes

| Code | Meaning                              |
|------|--------------------------------------|
| 0    | success                              |
| 2    | bad JSON / unknown kind / version    |
| 3    | step failed (step index in stderr)   |
| 4    | discuss timeout                      |

Legacy (no trigger) paths: exit 0 unchanged.

## Binaries

Two `main.go` packages sharing `internal/`:

- `mock-agent/cmd/mock-agent/main.go` — instant echo loop, supports normka
- `mock-agent/cmd/mock-long-agent/main.go` — streams mock output for `duration_ms` (or `MOCK_LONG_DURATION` default 30s), supports normka

Output to `bin/{mock-agent,mock-long-agent}` (replaces bash scripts). `at` finds them via existing `${LOCAL_BIN}/<name>` resolver; symlink or ensure `${LOCAL_BIN}` points to repo `bin/` via Make install target.

## Registry change (`src/agents/registry.ts`)

- `mock` and `mock-long` keep same `bin()` / `buildArgs()` shape.
- `buildArgs()` now **also** appends `--normka` when caller passes `normka: true` in options.
- No change to default tier-4 scheduling.

A new resolver helper `src/agents/normka-flag.ts` decides when `--normka` is required: caller-side opt-in via `at --normka <prompt>` (CLI plumbing lives in `src/cli.ts` and `src/runner.ts`).

## Build + tooling

- `mock-agent/go.mod` — module `agent-tier/mock-agent`, Go 1.21.
- `Makefile`:

  ```make
  BINDIR := bin
  GO     ?= /usr/local/go/bin/go

  build:
  	$(GO) build -o $(BINDIR)/mock-agent     ./cmd/mock-agent
  	$(GO) build -o $(BINDIR)/mock-long-agent ./cmd/mock-long-agent

  test-go:
  	$(GO) test ./...

  clean:
  	rm -f $(BINDIR)/mock-agent $(BINDIR)/mock-long-agent
  ```

- `package.json`:
  - `"build:mock": "make build"`
  - `"test:go": "make test-go"`
  - `"postinstall"` skipped (avoid surprising installs; devs and CI run `build:mock` explicitly).

## Tests

| Layer    | File                                                | Coverage                                                        |
|----------|-----------------------------------------------------|------------------------------------------------------------------|
| Go       | `mock-agent/internal/executor/*_test.go`            | Each kind: happy path + failure path + edge cases                |
| Go       | `mock-agent/internal/executor/trigger_test.go`      | Three trigger forms, no trigger → legacy path                   |
| Go       | `mock-agent/internal/dispatch_test.go`              | Unknown kind → error; empty steps → ok                          |
| TS       | `tests/agents-registry.test.ts` (extend)            | `buildArgs({ normka: true })` adds `--normka`                    |
| TS       | `tests/agents/normka-flag.test.ts`                  | CLI plumbing: `--normka` flag → options.normka → buildArgs       |
| E2E      | `tests/e2e/normka.test.ts`                          | Spawn real binary via `defaultSpawner`, assert stdout JSON lines |

## Guardrails

- `npx tsc --noEmit` (TS unchanged)
- `npx vitest run` (all TS tests; pre-existing `tests_ai/glm-code` failures allowed, nothing else)
- `make test-go` (Go unit tests)
- `make build` then `file bin/mock-agent` reports ELF, not `Bourne-Again shell script`

## Out of scope

- Real `at discuss` server (we only consume the endpoint; if absent, `discuss` step fails with exit 3).
- Reusing npm `postinstall` (devs run `build:mock` explicitly).
- Multi-arch cross-compile (Linux/amd64 only — matches agent-tier dev env).
