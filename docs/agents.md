# Agents

Detail doc for [README.md](../README.md).

## Tiers

| Tier          | Agents                         | Role                       |
|---------------|--------------------------------|----------------------------|
| 1             | glm-code, codex, kimi          | Architect / review         |
| 2 *(default)* | mm-code, opencode, qwen, pi, cline | Dev / QA                   |
| 3             | kilo, agy, kiro, devin | Experimental / boilerplate |
| 4             | mock, mock-long   | Dry-run / test agents      |

Round-robin state is stored per tier in the `scheduler` section of `<stateDir>/state.json`
(project `.at/` when present, else `~/.at/`).

## Available agents

`at` ships with **14 built-in agents** across 4 tiers, plus a generic plugin system for custom agents.

### Tier 1 — Architect / Review

Agents optimized for complex multi-file refactors, architecture review, and hard problems.

| Agent      | Binary (env override)                    | Command pattern                                       |
|------------|------------------------------------------|-------------------------------------------------------|
| `glm-code` | `GLM_CODE_BIN` → `~/.local/bin/glm-code` | `glm-code -p "prompt" --dangerously-skip-permissions` |
| `codex`    | `CODEX_BIN` → `~/.nvm/.../bin/codex`     | `codex exec --yolo --skip-git-repo-check "prompt"`    |
| `kimi`     | `KIMI_BIN` → `~/.nvm/.../bin/kimi`       | `kimi -y -p "prompt"`                                 |

Round-robin order: glm-code → codex → kimi → glm-code → …

### Tier 2 — Dev / QA (default)

Everyday feature work, bug fixes, tests, and refactors.

| Agent      | Binary (env override)                      | Command pattern                                        |
|------------|--------------------------------------------|--------------------------------------------------------|
| `mm-code`  | `MM_CODE_BIN` → `~/.local/bin/mm-code`     | `mm-code -p "prompt" --dangerously-skip-permissions`   |
| `opencode` | `OPENCODE_BIN` → `~/.nvm/.../bin/opencode` | `opencode run --dangerously-skip-permissions "prompt"` |
| `qwen`     | `QWEN_BIN` → `~/.nvm/.../bin/qwen`         | `qwen -y "prompt"`                                     |
| `pi`       | `PI_BIN` → `~/.nvm/.../bin/pi`             | `pi -p "prompt"` (`-m` adds `--model <name>`)          |
| `cline`    | `CLINE_BIN` → `~/.nvm/.../bin/cline`       | `cline --auto-approve true --json --cwd <cwd> --timeout 600 "prompt"` |

Round-robin order: mm-code → opencode → qwen → pi → cline → mm-code → …

### Tier 3 — Experimental / Boilerplate

Scaffolding, simple scripts, and throwaway generation.

| Agent    | Type   | Binary (env override)                  | Command pattern                                                            |
|----------|--------|----------------------------------------|----------------------------------------------------------------------------|
| `kilo`   | Cloud  | `KILO_BIN` → `~/.nvm/.../bin/kilo`     | `kilo run --auto "prompt"`                                                 |
| `agy`    | Cloud  | `AGY_BIN` → `findBin('agy')`           | `agy --dangerously-skip-permissions -p "prompt"`                            |
| `kiro`   | Cloud  | `KIRO_BIN` → `findBin('kiro-cli')`     | `kiro-cli chat --no-interactive --trust-all-tools "prompt"`                 |
| `devin`  | Cloud  | `DEVIN_BIN` → `~/.local/bin/devin` → devin-desktop path | `devin --permission-mode bypass --respect-workspace-trust false -p "prompt"` |

Round-robin order: kilo → agy → kiro → devin → kilo → …

### Tier 4 — Dry-run / Test

Deterministic stand-ins used by the test-suite and for smoke runs.

| Agent        | Binary (env override)                          | Command pattern |
|--------------|------------------------------------------------|-----------------|
| `mock`       | `MOCK_BIN` → `~/.local/bin/mock-agent`         | exits 0 immediately |
| `mock-long`  | `MOCK_LONG_BIN` → `~/.local/bin/mock-long-agent` | sleeps `MOCK_LONG_DURATION` ms (default 30000), then exits 0 |

### Model override

Pass `-m, --model <name>` to forward a model to agents that support it: `pi`
(adds `--model <name>`) and `opencode` (adds `-m <name>` and sets
`OPENCODE_MODEL`). Other agents ignore the flag. Generic plugin agents can
consume it via `buildArgs(prompt, model)` / `buildEnv(model)`.

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
