# `at bridge` — JSON RPC surface

Machine-readable entry point that external tools (the Go web proxy, T30) call
instead of parsing CLI text output. Implemented in `src/commands/bridge.ts`
(dispatch/envelopes) + `src/bridge/<resource>.ts` (one file per resource).

## Invocation

```
at bridge <resource> <verb> [id]
```

- **Input:** request params on **stdin** as a single JSON object. Empty stdin is
  treated as `{}`. There is no `--json` flag — stdin *is* JSON. The optional
  `[id]` positional is merged into params as `id` when present.
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
`INTERNAL`, `NOT_FOUND`, `INVALID`, `CONFLICT`.

## Resources & verbs

### `ping`

| Verb   | stdin params | data payload              |
| :----- | :----------- | :-------------------------- |
| `ping` | `{}`         | `{"version": "<semver>"}` |

Smoke/health verb for proxies.

### `agents`

| Verb     | stdin params | data payload                                                        |
| :------- | :----------- | :------------------------------------------------------------------ |
| `list`   | `{}`         | Array of agent entries — identical to `at agents --json` output today. |
| `health` | `{}`         | Array of health entries — one per registered agent (registry ∪ health merge, same as `list`), health fields only; agents with no health record get defaults. |

Entry shape: `{ tier, promptMode?, deactivated, failures, lastFailure, disabledTo, name }`.
Health entry shape: `{ name, deactivated, failures, lastFailure, disabledTo }`.

### `runs`

| Verb       | stdin params                          | data payload                                  |
| :--------- | :------------------------------------ | :-------------------------------------------- |
| `list`     | `{agent?, status?, limit?}` (all optional) | Array of `RunRecord` (see below), newest store order, joined across state dirs like `at status`. |
| `get`      | `{id}`                                | Single `RunRecord`, or `NOT_FOUND` (exit 3).  |
| `stop`     | `{id?, force?}` (no id → newest running) | `{ runId, pid, signal, alive, stopped }`. Signals via the same SIGTERM/SIGKILL path as `at stop` and marks the run failed in runs.jsonl. |
| `stop-all` | `{force?}`                            | `{ stopped: string[], errors: { runId, error }[] }`. Skips pids no longer alive (same as `at stop`). |

`RunRecord` shape: `{ runId, agent, tier, pid, prompt, logFile, startedAt, finishedAt, exitCode, status, name }`
where `status` is `running | done | failed | stuck`. Filters: `agent`/`status` are exact-match
strings, `limit` caps the number of returned records (positive number). Read-only: unlike
`at status`, no prune/stuck-annotation is applied to disk.

### `status`

| Verb  | stdin params | data payload |
| :---- | :----------- | :----------- |
| `get` | `{}`         | The exact object `at status --json` prints: `{ total, runs: RunRecord[], state: { scheduler, maxEntries, agents } }`. Same code path (naming-queue drain + locked refresh + join); the call prunes/annotates runs.jsonl exactly like `at status` does. |

### `feedback`

| Verb      | stdin params                    | data payload |
| :-------- | :------------------------------ | :----------- |
| `list`    | `{status?, kind?, agent?, tag?, limit?}` (all optional) | Array of feedback entries, newest first (same filter semantics as `at feedback list`). |
| `get`     | `{id}` (exact id or unique prefix) | Single feedback entry, or `NOT_FOUND` (exit 3). |
| `add`     | `{text, kind?, agent?, runId?, tier?, tags?, context?}` | `{ entry, evicted }`. Mirrors `at feedback add`; `text` ≤ 4000 chars. |
| `update`  | `{id, text?, kind?, status?, agent?, tags?}` | `{ entry }`. `kind` ∈ `bug|improvement|note`, `status` ∈ `open|resolved|wontfix`. |
| `resolve` | `{id, wontfix?}`                 | `{ entry }`. Default status `resolved`; `wontfix: true` → `wontfix`. |
| `rm`      | `{ids: string[]}`                | `{ removed: number }`. Each id is exact or unique prefix; ambiguous → USAGE. |

Feedback entry shape: `{ id, kind, text, agent?, runId?, tier?, status, tags?, createdAt, updatedAt, resolvedAt?, cwd?, atVersion?, context?, log? }`.
Same state-dir resolution as `at feedback` (`AT_STATE_DIR` → project `.at` with feedback.jsonl → `~/.at`).

### `kanban`

| Verb     | stdin params                                       | data payload |
| :------- | :------------------------------------------------- | :----------- |
| `list`   | `{board?}`                                         | Array of task objects, one per board row, keyed by the board's column headers (`ID`, `Status`, `Title`, …). |
| `show`   | `{id, board?}`                                     | Single task object, or `NOT_FOUND` (exit 3). |
| `next`   | `{board?}`                                         | `{ type: "current" | "next", task }` from the same selection logic as `at kanban next`, or `null` when nothing is executable. |
| `add`    | `{title?, priority?, description?, id?, owner?, blocks?, blockedBy?, plan?, board?}` | `{ id, title, updated, task }`. Mirrors `at kanban add`. |
| `status` | `{id, status, board?}`                             | `{ id, status }`. Status vocabulary comes from the board Status Legend; invalid → INVALID. |
| `remove` | `{id, board?}`                                     | `{ id }`. |

`board` overrides the board file (absolute/relative path); default resolution is
`AT_KANBAN_FILE` → `<project root>/docs/kanban.md`, same as `at kanban`. Read-only verbs take no lock;
mutations (`add`/`status`/`remove`) go through `mutateBoard` (same file lock as the CLI).
Missing board file → `NOT_FOUND` (exit 3).

### `config`

| Verb  | stdin params | data payload |
| :---- | :----------- | :----------- |
| `get` | `{}`         | The current HMAC-verified `~/.at/config.json` (`{ tierOverrides?, line?, sandbox?, jsonDefaults?, globalPrompt? }`), or `{}` when missing/tampered/unsigned. |

The HMAC secret is never stored in the config file (it comes from `AT_HMAC_SECRET`), so there is
nothing to redact. Verification is silent (`quiet`), matching JSON consumers' expectation of a
clean stdout envelope.

### `line`

| Verb   | stdin params    | data payload |
| :----- | :-------------- | :----------- |
| `add`  | `{agent}`       | `{ agent, line: string[] }`. Duplicate → CONFLICT; unknown agent → INVALID. |
| `rm`   | `{agent}`       | `{ agent, line: string[] }`. Absent agent or line queue → NOT_FOUND. |
| `move` | `{agent, position}` | `{ agent, position, line: string[] }`. 1-based position; out of range → INVALID. |

All three go through `src/commands/line.ts` (`saveConfig` re-signs the HMAC), so the on-disk
contract matches `at line add|rm|move`. Config dir resolved via `AT_CONFIG_DIR` (default `~/.at`).

### `events`

| Verb   | stdin params                                   | data payload                |
| :----- | :--------------------------------------------- | :-------------------------- |
| `tail` | `{ since?: 0, limit?: N }` plus optional `id` / `runId` | Array of stored `NotifyEvent` objects. |

- `id` / `runId` scopes to one run; omitted returns events for all runs.
- `since` is an exclusive seq cursor (defaults to `0`).
- `limit` caps the returned array (defaults to unlimited).

Event wire shape (same as `src/notify/types.ts`):

```json
{
  "runId": "string",
  "agent": "string",
  "ts": "ISO-8601",
  "seq": 1,
  "type": "start|message|tool|progress|error|done|question|answer|rename",
  "text": "string (optional)",
  "data": { "...": "optional adapter payload" }
}
```

### `discuss`

| Verb     | stdin params                        | data payload                          |
| :------- | :---------------------------------- | :------------------------------------ |
| `list`   | `{ runId: "...", pending?: false }` | Full thread (`DiscussEntry[]`).       |
| `list`   | `{ runId: "...", pending: true }`   | Unanswered questions only.            |
| `thread` | `{ runId: "..." }` or `id` positional | Full thread (`DiscussEntry[]`).       |
| `answer` | `{ runId: "...", qid: "...", text: "..." }` | `{ id: "mN" }` of the new answer.     |
| `say`    | `{ runId: "...", text: "..." }`     | `{ id: "mN" }` of the new host say.   |

`id` / `runId` identify the run. `answer` and `say` write to the run's state
 directory and reuse the existing discuss store path.

Discuss entry wire shape:

```json
{
  "id": "m1",
  "from": "agent|host",
  "kind": "question|answer|say|note",
  "text": "string",
  "options": ["..."],
  "replyTo": "mN",
  "ts": "ISO-8601"
}
```

### `health`

| Verb  | stdin params | data payload                                        |
| :---- | :----------- | :-------------------------------------------------- |
| `get` | `{}`         | Scheduler + agent-health snapshot (`StateReport`).  |

Payload matches `at status --json` state section: `{ scheduler, maxEntries, agents }`.

### `usage`

| Verb      | stdin params       | data payload |
| :-------- | :----------------- | :----------- |
| `summary` | `{ board?: string }` | `{ summary, budgets }` — `summary`: consumed time over finished runs + budget health (`tasksOverBudget`, `timeRatio`); `budgets`: per metered kanban task `{ taskId, estMs, actualMs, runs, timeState }` |

`runs list|get` also carry `taskId` once a run has finished.

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

- T27 — read verbs: done (`runs list|get`, `status get`, `agents health`, `feedback list|get`, `kanban list|show|next`, `config get`)
- T28 — mutations: done (`runs stop|stop-all`, `feedback add|update|resolve|rm`, `kanban add|status|remove`, `line add|rm|move`)
- T29 — streaming + health: done (`events tail`, `discuss list|thread|answer|say`, `health get`)
