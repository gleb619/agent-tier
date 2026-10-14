# `at bridge` — JSON RPC surface

Machine-readable entry point that external tools (the Go web proxy, T30) call
instead of parsing CLI text output. Implemented in `src/commands/bridge.ts`
(dispatch/envelopes) + `src/bridge/<resource>.ts` (one file per resource).

## Invocation

```
at bridge <resource> <verb> [params on stdin as JSON]
```

- **Input:** request params on **stdin** as a single JSON object. Empty stdin is
  treated as `{}`. There is no `--json` flag — stdin *is* JSON.
- **Output:** **stdout = JSON only**, exactly one line (compact, no pretty
  printing), terminated by `\n`. No banners, no ANSI escapes, no log lines on
  stdout. Logs go to stderr only.
- **Exit codes:** `0` ok · `2` usage error (missing args, unknown resource,
  unknown verb, invalid stdin JSON) · `3` application error.

## Envelopes

Success:

```json
{"ok":true,"data":<payload>}
```

Error (stdout is still valid JSON, one line):

```json
{"error":{"code":"<MACHINE_CODE>","message":"<human readable>"}}
```

Machine codes: `USAGE`, `UNKNOWN_RESOURCE`, `UNKNOWN_VERB`, `BAD_JSON`,
`INTERNAL`.

## Resources & verbs (core)

### `ping`

| Verb   | stdin params | data payload              |
| :----- | :----------- | :------------------------ |
| `ping` | `{}`         | `{"version": "<semver>"}` |

Smoke/health verb for proxies.

### `agents`

| Verb   | stdin params | data payload                                                        |
| :----- | :----------- | :------------------------------------------------------------------ |
| `list` | `{}`         | Array of agent entries — identical to `at agents --json` output today. |

Entry shape: `{ tier, promptMode?, deactivated, failures, lastFailure, disabledTo, name }`.

## Adding a resource

1. Create `src/bridge/<name>.ts` exporting a `BridgeResource`
   (`Record<string, BridgeHandler>`, see `src/bridge/types.ts`).
2. Each verb handler must be a **thin wrapper over existing store/command
   functions** (`run-store`, `health`, `config`, …). Parsing CLI text output
   inside a handler is forbidden; export the underlying function instead.
3. Register the resource in the `RESOURCES` map in `src/bridge/index.ts`.
4. Add a row to the table above and a contract test in `tests/bridge-core.test.ts`
   (or a `tests/bridge-<resource>.test.ts`).

## Roadmap

- T27 — read verbs: `runs list|get|log`, `stats`, `settings get`, …
- T28 — mutations: `run create|retry|delete`, `agent enable|disable`, `settings put`
- T29 — streaming: `events`, `discuss` (NDJSON)
