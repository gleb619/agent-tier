# Skill: delegate work to `at`

Use this skill when you want to hand off a coding task to another AI agent via the `at` CLI instead of implementing it yourself.

---

## When to use `at`

- You have a concrete, self-contained coding task (fix, refactor, generate, review).
- You want to run the task in the background while continuing other work.
- You want automatic retry across multiple agent backends.
- You are orchestrating several parallel tasks and want each one handled by a different agent.

---

## Decision: which mode to use

| Situation | Command form |
|-----------|-------------|
| Fire-and-forget background task | `at -p "..."` (default detached mode) |
| Need to watch output right now | `at -s -p "..."` |
| Specific agent required | `at -a <name> -p "..."` |
| Architect-level task (design, review) | `at -t 1 -p "..."` |
| Experimental / local model | `at -t 3 -p "..."` |
| Integrating with a pipeline / scripting | `echo '<json>' \| at --json` |

Default tier is **2** (dev/QA). Use tier 1 for anything that needs careful reasoning; tier 3 for boilerplate generation or offline models.

---

## Step-by-step

### 1. Write a precise prompt

A good `at` prompt is self-contained: another agent reading only that string must be able to complete the task without extra context.

```
Good:  "In src/auth/login.ts, add rate-limiting middleware that returns 429 after 5 failed attempts per IP within 60 s. Use the existing redis client at src/lib/redis.ts."
Bad:   "fix the auth stuff"
```

Include:
- What file(s) to touch
- What behaviour to implement or fix
- Any constraints (library to use, style guide, test requirement)

### 2. Choose a tier

```bash
at -t 1   # architect: glm-code → codex → kimi
at        # dev (default): blackbox → opencode → qwen
at -t 3   # experimental: kilo → gemini → goose → aider → pi
```

### 3. Run the command

```bash
# Detached (returns immediately, logs in /tmp/at-logs/)
at -p "add pagination to GET /api/users — page/limit query params, max 100"

# Stream (block until done)
at -s -p "write jest unit tests for src/utils/slugify.ts — cover edge cases"

# Specific agent
at -a opencode -p "refactor the payment module to use the repository pattern"

# Named model override
at -a opencode --json <<EOF
{"prompt":"rewrite the CSV parser using Papa Parse","model":"gpt-4o"}
EOF
```

### 4. Check the result

Detached mode prints the log path on startup:

```
[at] started opencode (pid 12345) — logs: /tmp/at-logs/at-2026-05-08T10-00-00-000Z-opencode.log
```

Follow the log:

```bash
tail -f /tmp/at-logs/at-2026-05-08T10-00-00-000Z-opencode.log
```

After the agent finishes, review the diff with `git diff` and run your test suite.

---

## JSON mode (pipeline / scripting)

Pipe a JSON object to `at --json` to integrate with automation:

```bash
echo '{
  "agent": "opencode",
  "prompt": "add OpenAPI annotations to all route handlers in src/routes/",
  "model": "gpt-4o",
  "cwd": "/home/user/my-project",
  "env": { "NODE_ENV": "development" }
}' | at --json
```

Fields: `prompt` (required), `agent`, `model`, `cwd`, `env` (all optional).

---

## Retry and failure handling

`at` automatically retries on non-zero exit by picking the next agent in the same tier (up to `--retries`, default 2). You do not need to manually retry.

If all agents in a tier fail, `at` exits non-zero and prints the last error. At that point either:
- Rewrite the prompt to be clearer, or
- Switch to a different tier with `-t`.

---

## Custom / generic agents

If your environment has agents not in the built-in registry, check `~/.at/` for plugin directories. Each plugin exposes a `generic.js` with `tier`, `bin`, and `buildArgs`. No code changes required — `at` discovers them automatically.

To add one:

```bash
mkdir -p ~/.at/my-agent
cat > ~/.at/my-agent/generic.js << 'EOF'
module.exports = {
  tier: 2,
  bin: () => '/usr/local/bin/my-agent',
  buildArgs: (prompt) => ['--task', prompt],
};
EOF
```

---

## Quick reference

```bash
at -p "<prompt>"                     # tier 2, detached, auto agent
at -s -p "<prompt>"                  # stream to terminal
at -t 1 -p "<prompt>"               # architect tier
at -t 3 -p "<prompt>"               # experimental tier
at -a <name> -p "<prompt>"          # named agent, no retry
at -r 0 -p "<prompt>"               # no retry
at --global-state -p "<prompt>"     # shared round-robin across tiers
at --log-dir /var/log/at -p "..."   # custom log directory
echo '<json>' | at --json            # JSON mode
at config sign                       # sign ~/.at/config.json after editing
```
