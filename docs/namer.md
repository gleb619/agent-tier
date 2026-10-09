# Session Namer — `at` CLI

The `--namer` flag asks a small LLM to name the session (e.g. `refactor-auth-middleware-please`) from your prompt. The name lands on the run record (`at status` NAME column) and is surfaced in the TUI sidebar.

The namer is enrichment, never a blocker. Generation runs **asynchronously** in the background; the child agent is spawned immediately with the placeholder `'unnamed'`, and the real name lands a few hundred milliseconds later via a write to `runs.jsonl` plus an SSE `rename` event (if SSE is enabled).

## Sources, in order

`~/.at/namer.json` declares an ordered list of providers. **First provider whose `isAvailable()` + `generate()` both succeed wins.** Total wall time ≈ slowest provider's timeout (about 12 s for the three defaults), but the run pipeline doesn't wait.

If every provider fails or the config is missing, the run falls back to the deterministic placeholder `'unnamed'`.

## Files

### `~/.at/namer.json` — provider config (no secrets)

Default location: `~/.at/namer.json`. Override with `AT_NAMER_CONFIG=/path/to/namer.json`.

Minimal example (the 3-provider default in the plan):

```json
{
  "providers": [
    {
      "name": "boris3pc",
      "type": "ollama-ssh-tunnel",
      "ssh": {
        "host": "borispc3.ai",
        "user": "boris",
        "port": 22,
        "identityFile": "~/.ssh/id_rsa"
      },
      "remoteUrl": "http://127.0.0.1:11434",
      "model": "gemma3:1b",
      "timeoutMs": 4000
    },
    {
      "name": "openrouter",
      "type": "openrouter",
      "url": "https://openrouter.ai/api/v1/chat/completions",
      "model": "google/gemini-2.0-flash-exp:free",
      "apiKeyRef": "openrouter",
      "timeoutMs": 4000
    },
    {
      "name": "local-ollama",
      "type": "ollama",
      "url": "http://localhost:11434",
      "model": "gemma3:1b",
      "timeoutMs": 3000
    }
  ],
  "fallbackName": "unnamed",
  "minLen": 20,
  "maxLen": 40
}
```

Provider kinds (`type`):

| `type`               | Required fields                                                              |
|----------------------|------------------------------------------------------------------------------|
| `ollama`             | `url`, `model`, `timeoutMs`                                                  |
| `openrouter`         | `url`, `model`, `apiKeyRef` (optional), `timeoutMs`                          |
| `ollama-ssh-tunnel`  | `ssh: { host, user, port?, identityFile? }`, `remoteUrl`, `model`, `timeoutMs` |

`apiKeyRef` is a **logical name**, never a literal key. The loader resolves it against `~/.at/secrets.json` (or `AT_NAMER_SECRETS`) and env.

### `~/.at/secrets.json` — API keys (gitignored, never logged)

```json
{
  "openrouter": "sk-or-v1-xxxxxxxxxxxxxxxxxxxx"
}
```

The file **must be mode 0o600**. The loader refuses to read group/world-writable files (logs a warning, treats as missing). You are responsible for `chmod 600`.

Override path: `AT_NAMER_SECRETS=/custom/secrets.json`.

### Defaults when files are missing

| State                                       | Behaviour                                                |
|---------------------------------------------|----------------------------------------------------------|
| `namer.json` missing                        | Use embedded single-provider `local-ollama` fallback.    |
| `namer.json` corrupt                        | `console.warn` + embedded single-provider fallback.      |
| `secrets.json` missing                      | Providers with `apiKeyRef` are **skipped** (no error).   |
| `secrets.json` mode > 0o600                 | `console.warn` ("refusing to read group/world-writable secrets file") + treat as missing. |

## Secret resolution order

For a given `apiKeyRef`, the loader checks:

1. `process.env[apiKeyRef.toUpperCase().replace(/-/g, '_')]` (e.g. `OPENROUTER`)
2. `secrets.json[apiKeyRef]`

If both are missing, the provider's `isAvailable` returns `false` and the orchestrator moves on.

The resolved map is **never** logged.

## CLI flags

| Flag               | Status     | Behaviour                                                  |
|--------------------|-----------|------------------------------------------------------------|
| `--namer`          | active    | On/off switch.                                             |
| `--namer-model`    | DEPRECATED| No-op; prints warning. Use `model` in `namer.json`.        |
| `--namer-url`      | DEPRECATED| No-op; prints warning. Use `url` / `remoteUrl` in config.  |

## Backwards compatibility

- `RunRecord.name: string` always present, defaults to `'unnamed'`.
- `AT_RUN_NAME` env var is set at spawn with the placeholder; updated on disk only.
- `at status` NAME column renders `'unnamed'` until the async name lands.
- The `--namer-model` / `--namer-url` flags still parse (they appear in `RunOptions.namerModel` / `namerUrl`) but the runner no longer reads them.

## Smoke tests

- `at -p "echo test" -a mock --namer` with no `~/.at/namer.json`: works against local-ollama fallback. Log shows `namer: provider local-ollama unavailable, skipping` or successful naming.
- All 3 providers configured, network fine: log shows which provider won (`namer: named via openrouter`).
- All providers failing: log shows three provider failures, run continues with `'unnamed'`, exit 0, `at status` shows `'unnamed'`.
- `at status` after a run where the name arrived asynchronously: NAME column shows the real name.
- `chmod 644 ~/.at/secrets.json` then `--namer`: warning appears, openrouter skipped, remaining providers still tried.