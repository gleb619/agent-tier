# Agents

Detail doc for [README.md](../README.md).

## Tiers

| Tier          | Agents                         | Role                       |
|---------------|--------------------------------|----------------------------|
| 1             | glm-code, codex, kimi          | Architect / review         |
| 2 *(default)* | mm-code, opencode, qwen, pi, cline | Dev / QA                   |
| 3             | kilo, agy, kiro, cursor | Experimental / boilerplate |
| 4             | mock, mock-long   | Dry-run / test agents      |

Round-robin state is stored in `/tmp/at-<tier>-state.json`. Pass `--global-state` to use a single counter across all tiers.

## Available agents

`at` ships with **11 built-in agents** across 3 tiers, plus a generic plugin system for custom agents.

> Note: agent list updated after the blackbox/goose/aider removal. Tier 2: mm-code, opencode, qwen, pi, cline.
> Tier 3: kilo, agy, cursor.

### Tier 1 — Architect / Review

Agents optimized for complex multi-file refactors, architecture review, and hard problems.

| Agent      | Binary (env override)                    | Command pattern                                       |
|------------|------------------------------------------|-------------------------------------------------------|
| `glm-code` | `GLM_CODE_BIN` → `~/.local/bin/glm-code` | `glm-code -p "prompt" --dangerously-skip-permissions` |
| `codex`    | `CODEX_BIN` → `~/.nvm/.../bin/codex`     | `codex exec "prompt"`                                 |
| `kimi`     | `KIMI_BIN` → `~/.nvm/.../bin/kimi`       | `kimi -y -p "prompt"`                                 |

Round-robin order: glm-code → codex → kimi → glm-code → …

### Tier 2 — Dev / QA (default)

Everyday feature work, bug fixes, tests, and refactors.

| Agent      | Binary (env override)                      | Command pattern                                        |
|------------|--------------------------------------------|--------------------------------------------------------|
| `mm-code`  | `MM_CODE_BIN` → `~/.local/bin/mm-code`     | `mm-code -p "prompt" --dangerously-skip-permissions`   |
| `opencode` | `OPENCODE_BIN` → `~/.nvm/.../bin/opencode` | `opencode run --dangerously-skip-permissions "prompt"` |
| `qwen`     | `QWEN_BIN` → `~/.nvm/.../bin/qwen`         | `qwen -y "prompt"`                                     |
| `pi`       | `PI_BIN` → `~/.nvm/.../bin/pi`             | `pi -p --provider ollama --model ... "prompt" --no-session` |
| `cline`    | `CLINE_BIN` → `~/.nvm/.../bin/cline`       | `cline --auto-approve true --json --timeout 600 "prompt"` |

Round-robin order: mm-code → opencode → qwen → pi → cline → mm-code → …

### Tier 3 — Experimental / Boilerplate

Scaffolding, simple scripts, and throwaway generation. Three of these agents use **Ollama** with local models.

| Agent    | Type   | Binary (env override)                  | Command pattern                                                            |
|----------|--------|----------------------------------------|----------------------------------------------------------------------------|
| `kilo`   | Cloud  | `KILO_BIN` → `~/.nvm/.../bin/kilo`     | `kilo run --auto "prompt"`                                                 |
| `agy`    | Cloud  | `AGY_BIN` → `~/.nvm/.../bin/agy`       | `echo "prompt" \| agy --yolo --skip-trust`                                  |
| `cursor` | Cloud  | `CURSOR_BIN` → `~/.local/bin/cursor-agent` | `cursor-agent -p "prompt" --yolo --trust`                               |

Round-robin order: kilo → agy → cursor → kilo → …

### Ollama agents

The single Ollama-based agent (`pi`) shares common configuration:

- **Host:** `OLLAMA_HOST` (default: `http://127.0.0.1:11434`)
- **Model:** `OLLAMA_MODEL` (default: `minimax-m3:cloud`)
- **Per-run model override:** set env var `OLLAMA_AGENT_MODEL` before calling `at`

Note: `pi` requires an Ollama provider entry in `~/.pi/agent/models.json`.

### Prompt mode

Most agents receive their prompt as a CLI argument (`promptMode: 'arg'`). One exception:

- **`agy`**: uses `promptMode: 'stdin'` — the prompt is piped to the agent's stdin rather than passed as an argument.
  `at` handles this internally; no special flags needed.

## Generic agents (plugins)

You can add custom agents without modifying the source code. Drop a directory under `~/.at/<agent-name>/generic.js`:

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

The directory name becomes the agent name. Override the scan directory with `AT_GENERIC_DIR`. Agents are validated at
load time — `tier` must be 1/2/3, `bin` and `buildArgs` must be functions.

## Binary resolution

Each agent binary is resolved in this order:

1. Environment variable override (e.g. `OPENCODE_BIN`, `KILO_BIN`)
2. `$NODE_BIN/<name>` — defaults to the directory of the running `node` binary
3. `$LOCAL_BIN/<name>` — defaults to `~/.local/bin`

Override `NODE_BIN` or `LOCAL_BIN` to point at a different installation path.

## Configuration

`~/.at/config.json` supports per-agent tier overrides:

```json
{
  "tierOverrides": {
    "opencode": 1,
    "cursor": 2
  }
}
```

After editing, sign the file to prevent tampering detection:

```bash
at config sign
```

The HMAC secret defaults to `at-config-hmac-v1`; override with `AT_HMAC_SECRET`.
