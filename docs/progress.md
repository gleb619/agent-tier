# Live progress (SSE) & discuss

Detail doc for [README.md](../README.md).

## Live progress (SSE)

`at` can stream structured progress events over an in-process HTTP/SSE hub while an agent runs. Use it to wire a TUI, dashboard, or another process to the agent's output without polling the log file.

### Flags

| Flag                  | Behavior                                                                                |
|-----------------------|-----------------------------------------------------------------------------------------|
| `--sse`               | Start an SSE hub and publish events for this run (port defaults to 0 = OS-assigned).    |
| `--sse <port>`        | Pin the hub to a specific port.                                                          |

The SSE URL for the run is printed in the launch banner:
```
[at] │ SSE:     http://127.0.0.1:42095/events/<runId>
```

### Endpoints

| Method | Path                    | Purpose                                                                                  |
|--------|-------------------------|------------------------------------------------------------------------------------------|
| GET    | `/events/<runId>`       | SSE stream of events for one run. Replays stored events then live-broadcasts new ones.   |
| GET    | `/events`               | SSE stream across all runs (sorted by `seq`).                                            |
| POST   | `/emit/<runId>`         | Publish a synthetic event (used by `at notify <runId> "<msg>"` from inside the agent).   |

Both GET endpoints honor `Last-Event-ID` for replay resume.

### Event schema

Every SSE message is `data: <json>` with this shape:
```json
{
  "runId": "white-quiet-saturn-3fepf",
  "agent": "qwen",
  "ts":    "2026-10-09T04:40:00.000Z",
  "seq":   7,
  "type":  "message",
  "text":  "human-readable line",
  "data":  { "...": "agent-specific payload" }
}
```
`type` is one of `start | message | tool | progress | error | done`. The terminal `done` event carries `data.status` (`done` or `failed`) and `data.exitCode`.

### Adapter table

`at` picks a per-agent adapter that converts the agent's raw output into NotifyEvents. Some agents have a structured mode (`--output-format stream-json`, `--json`, etc.); others fall back to the log adapter, which appends a `promptSuffix` telling the agent to call `at notify <runId> "<msg>"` at milestones.

| Agent       | Mechanism                                              |
|-------------|--------------------------------------------------------|
| mm-code     | `--output-format stream-json --verbose`                |
| glm-code    | `--output-format stream-json --verbose`                |
| codex       | `--json` (inserted before the prompt)                  |
| kimi        | `--output-format stream-json`                          |
| qwen        | `--output-format stream-json` (inserted before prompt) |
| opencode    | `--format json`                                        |
| pi          | `--mode json`                                          |
| cline       | `--json` (already in buildArgs)                        |
| kilo        | `--format json`                                        |
| kiro        | `--agent-engine v2 --output-format stream-json` (after `chat`) |
| cursor      | log fallback (no structured mode exposed)              |
| agy         | log fallback (stdin-piped prompt)                      |
| mock / mock-long | log fallback                                       |

### Environment variables

The runner exports these to the child process:

| Var           | Meaning                                                |
|---------------|--------------------------------------------------------|
| `AT_RUN_ID`   | The run's id (also passed via promptSuffix).           |
| `AT_SSE_URL`  | `http://127.0.0.1:<port>` — hub base URL.              |
| `AT_EVENT_FILE` | `<stateDir>/events/<runId>.jsonl` — file fallback.   |

### Adding an adapter

1. Create `src/notify/adapters/<name>.ts` exporting `make<Name>Adapter(): NotifyAdapter`.
2. If the agent's structured flags need a specific position, implement `transformArgs(ctx, baseArgs)` (returns the full argv with the flag inserted) instead of `args()`. Use it to splice flags before the prompt positional.
3. Implement `parseLine(line)` — return `[]` for non-matching / malformed input. Never throw.
4. Register in `src/notify/index.ts` via `registerAdapter(name, make<Name>Adapter())`.
5. Add `tests/notify/adapter-<name>.test.ts` + a real fixture at `tests/notify/fixtures/<name>.jsonl` (3-5 lines captured from a tiny `timeout 30 <bin> ...` invocation).
6. Agents without a structured mode need no work — `getAdapter()` falls through to `logAdapter`.

## Discuss channel

`at discuss` is a two-way conversation channel layered on top of the SSE hub. Agents use it to ask the host a decision-blocking question (and block until answered); the host uses it to push instructions, answer questions, or watch the thread live. Everything is persisted to `<stateDir>/events/<runId>.discuss.jsonl` and mirrored as SSE events so dashboards see the conversation in real time.

### Commands

```
# Agent side (runId defaults to $AT_RUN_ID)
at discuss ask "Deploy to prod?" -o yes -o no [--timeout 300] [--default yes]
at discuss note "lint fixed in src/api.ts"
at discuss inbox [--wait 30] [--since m4]

# Host side
at discuss list [runId] [--pending] [--json] [-R/--run <runId>]
at discuss answer [-q mN] <text...> [-R/--run <runId>]   # defaults to latest unanswered; first arg mN treated as qid
at discuss say "now bump the version" [-R/--run <runId>]
at discuss watch [-R/--run <runId>]                       # follow thread live; prompts in TTY
```

`at notify <runId> <msg...>` is kept as an alias for `at discuss note`.

### Storage

A single JSONL thread per run: `<stateDir>/events/<runId>.discuss.jsonl`.

```jsonl
{"id":"m1","from":"agent","kind":"question","text":"deploy to prod?","options":["yes","no"],"ts":"..."}
{"id":"m2","from":"host","kind":"answer","text":"yes","replyTo":"m1","ts":"..."}
{"id":"m3","from":"host","kind":"say","text":"now bump the version","ts":"..."}
{"id":"m4","from":"agent","kind":"note","text":"bumped to 0.1.2","ts":"..."}
```

When `AT_SSE_URL` is set, `ask` / `note` / `say` / `answer` POST to the hub (which persists + broadcasts); otherwise they append directly to the file.

### Hub endpoints

| Method | Path                       | Purpose                                                   |
|--------|----------------------------|-----------------------------------------------------------|
| POST   | `/discuss/<runId>`         | Append `{from, kind, text, options?, replyTo?}`. Mirrors to SSE. |
| GET    | `/discuss/<runId>`         | Return the full thread as JSON.                           |
| GET    | `/discuss/<runId>?pending=1` | Return only unanswered questions.                       |

The legacy `POST /emit/<runId>` still works.

### Flow

```
agent process                                 host
─────────────                                 ────
$AT_BIN discuss ask "deploy?" ──► SSE ──► hub writes m1, broadcasts 'question' SSE
                                  └──► list/watch on host side show m1
host: at discuss answer m1 "yes" ──► SSE ──► hub writes m2 (replyTo=m1), broadcasts 'answer'
                                  └──► agent unblocks, prints "yes" to stdout
```

### Discuss environment variables

In addition to the variables listed under [Live progress](#environment-variables), the runner exports:

| Var             | Meaning                                                       |
|-----------------|---------------------------------------------------------------|
| `AT_BIN`        | Shell-quoted `node /abs/dist/cli.js`. Agent uses it as `$AT_BIN discuss ...`. |
| `AT_STATE_DIR`  | The state dir passed to `resolveStateDir()`. The `--state-dir` flag also works on every `discuss` subcommand. |
| `AT_RUN_ID`     | (existing) The run id; `discuss` subcommands default to it.   |
| `AT_SSE_URL`    | (existing) When set, entries POST to the hub instead of writing the file. |

### Prompt injection

`src/notify/prompt.ts` exports `DISCUSS_INSTRUCTION`, which is appended to every adapter's `promptSuffix`:

```
Host channel: if you need a decision, run `$AT_BIN discuss ask "<question>" -o <opt> -o <opt>`
and use its stdout as the answer (blocks until answered). Post milestones with
`$AT_BIN discuss note "<msg>"`. Check `$AT_BIN discuss inbox` for new host instructions
at milestones.
```

The log adapter keeps its legacy `at notify <runId>` line in addition, so log-fallback agents see both old and new wording.
