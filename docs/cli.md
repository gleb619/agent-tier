# CLI usage

Detail doc for the flags in [README.md](../README.md).

## Sending prompts

Three ways to pass a prompt:

```bash
# Flag
at -p "fix the login bug"

# Stdin pipe
echo "fix the login bug" | at

# JSON mode
echo '{"agent":"opencode","prompt":"fix the login bug"}' | at --json
```

## Output modes

| Mode               | Behavior                                                                                                                                                  |
|--------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------|
| Detached (default) | Agent spawns in the background; `at` prints the run box (runId, pid, log path) and returns immediately. A background supervisor (`src/run-watch.ts`) marks the run done (`exitCode: null`) and runs `--callback`. |
| Detached `--wait`  | Same as detached, but blocks until the agent exits. Enables `--timeout`, retry, agent-health tracking and a callback with the real exit code.              |
| Stream (`-s`)      | Agent output is streamed to the terminal and simultaneously written to a log file. Blocks until the agent exits.                                          |
| SSE (`--sse`)      | Live progress streamed over HTTP/SSE. See [Live progress (SSE)](progress.md#live-progress-sse).                                                                       |

## Retry behavior

When an agent exits non-zero, `at` automatically picks the next agent in the same tier and retries, up to
`min(retries, candidates.length - 1)` additional attempts. Named agents (`-a <name>`) never retry.

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

All fields except `prompt` are optional.
