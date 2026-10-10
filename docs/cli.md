# CLI usage

Detail doc for the flags in [README.md](../README.md).

## Sending prompts

Four ways to pass a prompt:

```bash
# Flag
at -p "fix the login bug"

# Stdin pipe
echo "fix the login bug" | at

# Prompt file (-f): .md is read as raw text; .json uses its top-level `prompt`
# string field, falling back to the raw file contents
at -f prompts/fix-login.md

# JSON mode
echo '{"agent":"opencode","prompt":"fix the login bug"}' | at --json
```

Precedence when several are given: an explicit source always wins over a
missing one — stdin pipe > `-f` file > `-p` text (non-JSON mode). In JSON mode:
JSON `prompt` > JSON `promptFile` > `-f` file > `-p` text.

## Output modes

| Mode               | Behavior                                                                                                                                                  |
|--------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------|
| Detached (default) | Agent spawns in the background; `at` prints the run box (runId, pid, log path) and returns immediately. A background supervisor (`src/run-watch.ts`) names the run, marks it done (`exitCode: null`) and runs `--callback`. |
| Detached `--wait`  | Same as detached, but blocks until the agent exits. Enables `--timeout`, retry, agent-health tracking and a callback with the real exit code.              |
| Stream (`-s`)      | Agent output is streamed to the terminal and simultaneously written to a log file. Blocks until the agent exits.                                          |
| SSE (`--sse`)      | Live progress streamed over HTTP/SSE. See [Live progress (SSE)](progress.md#live-progress-sse).                                                                       |

## Retry behavior

When an agent exits non-zero, `at` automatically picks the next agent in the same tier and retries, up to
`min(retries, candidates.length - 1)` additional attempts. Named agents (`-a <name>`) never retry.

## Other flags

| Flag | Behavior |
|------|----------|
| `-f, --prompt-file <path>` | Read the prompt from a file — `.md` raw text, `.json` uses its `prompt` field |
| `-m, --model <name>` | Pass a model name to the agent (agent-specific: arg and/or env) |
| `--timeout <ms>` | Force-kill the agent after N ms (default: 3600000 = 1h) |
| `--no-chop` | Disable chop output-log compression in stream mode (default: enabled when chop is available) |
| `--state-dir <path>` | Override the state directory (default: `.at/` in CWD if it exists, else `~/.at/`) |
| `--sse [port]` | Live-progress SSE hub, default port 7777, `0` = random (see [progress.md](progress.md)) |
| `--global-prompt <text>` | Global prompt text prepended to every run's prompt |

## Global prompt

Set a reusable global prompt in `~/.at/config.json` as `"globalPrompt": "your instructions here"`. It is
prepended (with a blank line) to every run's prompt before sending it to the agent. Override it per-run with
`--global-prompt`.

In JSON mode (`--json`), the JSON `globalPrompt` field and `--global-prompt` also work, with precedence:
CLI `--global-prompt` > JSON `globalPrompt` > config `globalPrompt`.

## Post-run verification hook

`--verify <command>` runs a shell command **after** the agent exits and **before** `--callback`.
A non-zero exit fails the run: the run record flips to `status: failed`, a line is appended to the run log
(`[at] verify failed (exit N): <cmd>` plus the first lines of its output), `--callback` still fires with
`AT_STATUS=failed`, and in blocking modes (`-s` / `--wait`) `at` raises `AgentError('verify failed …')`
so the existing retry-with-next-agent loop applies (a verify failure is treated like an agent failure for
retry purposes).

Use it to fail a run when an agent finishes but leaves the worktree broken — e.g. uncommitted formatting,
uncompiled TypeScript, missing migrations:

```bash
at -s -p "implement the new feature" --verify 'npx tsc --noEmit && npx eslint src'
# detached: AT_VERIFY_CMD env travels to the run-watch supervisor so the same hook fires
at -p "implement the new feature" --verify 'npx tsc --noEmit'
```

The verify command runs in the agent's working directory (`--cwd` when set, else `process.cwd()` for
detached supervisor runs). It receives the same `AT_*` env contract as `--callback` (runId, agent, tier,
exit code, log path, prompt, status) so it can react to agent failures the same way.

## JSON mode

Accepts a JSON object from stdin, compatible with the `coding-agent` protocol:

```json
{
  "agent": "opencode",
  "prompt": "add pagination to the users endpoint",
  "model": "gpt-4o",
  "cwd": "/path/to/repo",
  "env": { "SOME_VAR": "value" }
}
```

All fields except `prompt` are optional. Extra fields: `promptFile` (path, used
when `prompt` is absent), `callback` and `verify` (shell commands, same contract
as the flags), `sse` (boolean) and `ssePort` (number, `0` = random).

## Compose (plan → implement → check)

`at compose` runs one goal through a fixed state machine instead of a single agent call.
Tier 1 plans and judges; tier 2 only implements.

```bash
at compose -p "add retry to the resolver" --test-cmd 'npm test'
at compose --goal "..." --max-rounds 5 --max-nodes 40
at compose -p "..." --resume <goalId>     # continue a saved run
```

States: `INVESTIGATE` (`at index init` when `.codegraph` is missing, then `at index sync`, codegraph
context → `context.md`) → `PLAN` (tier 1 writes `plan.md`: requirements, design notes, `- [ ] N. task`
checklist) → `IMPLEMENT` (tier 2 per unchecked task, ticked on exit 0, first failure stops the run) →
`CHECK` (runs `--test-cmd` locally, then tier 1 reads the plan, `git diff` and the test tail and writes
`verdict.md`). `PASS` → `DONE` (exit 0). `FAIL` re-plans with the verdict findings appended as new
unchecked tasks; after `--max-rounds` (default 3) the run ends `FAILED` (exit 1). A verdict whose first
line is neither `PASS` nor `FAIL` counts as `FAIL`.

Artifacts and `state.json` (`{ goal, state, round, testCmd, maxRounds }`, saved after every transition)
live in `~/.at/compose/<goalId>/`. A missing `plan.md`/`verdict.md` or a non-zero agent exit aborts with
the failing state named in the message and exit 1.

