# at — Agent Tier Router

`at` is a thin CLI that routes a coding prompt to one of many AI agent binaries via round-robin scheduling and automatic
retry.

## Install

```bash
npm install
npm run build
# Binary is at dist/cli.js, or install globally:
npm link
```

## Quick start

```bash
# Send a prompt to the default tier (tier 2: dev/QA)
at -p "add error handling to src/api.ts"

# Stream output directly to your terminal
at -s -p "refactor the auth module"

# Target a specific agent
at -a opencode -p "write tests for the parser"

# Use a specific tier
at -t 1 -p "review this PR diff"
```

## CLI reference

```
at [options] [command]

Options:
  -p, --prompt <text>     Prompt text (or pipe via stdin)
  -a, --agent <name>      Agent name, or "auto" (default: auto)
  -t, --tier <number>     Tier: 1=architect, 2=dev (default), 3=experimental
  -s, --stream            Stream output to terminal (default: detached + log file)
  -r, --retries <number>  Max retry attempts on non-zero exit (default: 2)
  --global-state          Single round-robin counter shared across all tiers
  --log-dir <path>        Log directory for detached mode (default: /tmp/at-logs)
  --json                  Read JSON from stdin (see JSON mode below)

Commands:
  config sign             HMAC-sign ~/.at/config.json
```

### Sending prompts

Three ways to pass a prompt:

```bash
# Flag
at -p "fix the login bug"

# Stdin pipe
echo "fix the login bug" | at

# JSON mode
echo '{"agent":"opencode","prompt":"fix the login bug"}' | at --json
```

### Output modes

| Mode               | Behavior                                                                                                   |
|--------------------|------------------------------------------------------------------------------------------------------------|
| Detached (default) | Agent spawns in the background; logs go to `/tmp/at-logs/at-<timestamp>-<agent>.log`. Returns immediately. |
| Stream (`-s`)      | Agent's stdio is inherited by the terminal. Blocks until the agent exits.                                  |

## Tiers

| Tier          | Agents                         | Role                       |
|---------------|--------------------------------|----------------------------|
| 1             | glm-code, codex, kimi          | Architect / review         |
| 2 *(default)* | blackbox, opencode, qwen       | Dev / QA                   |
| 3             | kilo, gemini, goose, aider, pi | Experimental / boilerplate |

Round-robin state is stored in `/tmp/at-<tier>-state.json`. Pass `--global-state` to use a single counter across all tiers.

## Retry behavior

When an agent exits non-zero, `at` automatically picks the next agent in the same tier and retries, up to
`min(retries, candidates.length - 1)` additional attempts. Named agents (`-a <name>`) never retry.

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

## Binary resolution

Each agent binary is resolved in this order:

1. Environment variable override (e.g. `OPENCODE_BIN`, `GEMINI_BIN`)
2. `$NODE_BIN/<name>` — defaults to `~/.nvm/versions/node/v22.20.0/bin`
3. `$LOCAL_BIN/<name>` — defaults to `~/.local/bin`

Override `NODE_BIN` or `LOCAL_BIN` to point at a different installation path.

## Configuration

`~/.at/config.json` supports per-agent tier overrides:

```json
{
  "tierOverrides": {
    "opencode": 1,
    "goose": 2
  }
}
```

After editing, sign the file to prevent tampering detection:

```bash
at config sign
```

The HMAC secret defaults to `at-config-hmac-v1`; override with `AT_HMAC_SECRET`.

## Generic agents (plugins)

Drop a directory under `~/.at/<agent-name>/generic.js` to register a custom agent without modifying the source:

```js
// ~/.at/my-agent/generic.js
module.exports = {
  tier: 2,
  bin: () => '/usr/local/bin/my-agent',
  buildArgs: (prompt, model) => ['--task', prompt],
  // optional:
  buildEnv: (model) => ({ MY_MODEL: model ?? 'default' }),
  promptMode: 'arg',  // or 'stdin'
};
```

Override the scan directory with `AT_GENERIC_DIR`.

## Development

```bash
npm run dev          # run without building (ts-node)
npm run build        # compile to dist/
npm test             # jest
npm run test:watch   # jest --watch
npx jest tests/runner.test.ts   # single file
```

## Architecture

```
src/cli.ts               parse flags + stdin → resolveFromArgs/parseJsonInput → run()
src/resolver.ts          normalise raw argv/JSON into a typed RunOptions struct
src/scheduler.ts         round-robin state: read/write /tmp/at-<tier>-state.json
src/runner.ts            spawn agent process (stream or detached), retry on non-zero exit
src/agents/registry.ts   AgentDef[] — name, tier, bin(), buildArgs(), buildEnv(), promptMode
src/agents/generic-loader.ts  discover plugins from ~/.at/*/generic.js
src/config.ts            load ~/.at/config.json with HMAC verification
```

**Flow:** `CLI → Resolver → Runner → Scheduler → child process`

### Adding a built-in agent

Add a new `AgentDef` entry to `AGENTS` in `src/agents/registry.ts`. Implement `bin()`, `buildArgs()`, and optionally
`buildEnv()` and `promptMode`. No other files need changing.
