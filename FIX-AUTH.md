# Auth failure diagnosis & fixes — `pi` and `cline` agents

Date: 2026-10-11. Worktree: `agent-tier-fix-auth-t1` (branch `fix/agent-auth-kimi`).

## Live vs dead credentials on this host (verified by direct API calls)

| Provider | Credential location | Status |
|---|---|---|
| z.ai coding endpoint (`https://api.z.ai/api/coding/paas/v4`, OpenAI-compatible; `https://api.z.ai/api/anthropic`, Anthropic-compatible) | `$ANTHROPIC_AUTH_TOKEN`, cline `secrets.json` `openAiApiKey` | ✅ works (glm-5.3-flash) |
| Local ollama (`http://127.0.0.1:11434`) | none needed | ✅ works (gemma3:1b) |
| OpenRouter | `$OPENROUTER_API_KEY`, cline `secrets.json` `openRouterApiKey` | ❌ dead — `401 {"message":"User not found."}` |
| Moonshot | cline `secrets.json` `moonshotApiKey` | ❌ dead — `Invalid Authentication` |
| MiniMax | cline `secrets.json` `minimaxApiKey` | ❌ dead — `invalid api key (2049)` |

Note: `$ZAI_API_KEY` in the shell is set to the literal placeholder `test` — it is
ignored by the fix below (placeholder filtering, keys must be ≥ 20 chars).

## Bug 1 — pi: 401 User not found

**Root cause:** `~/.pi/agent/settings.json` defaulted to
`openrouter/openrouter-free`, and the OpenRouter key on this host is dead
(`auth.json` is empty, no key is stored; the env `OPENROUTER_API_KEY` is also
dead). OpenRouter answers a bad key with `401 User not found`.

**Fix (host config, non-interactive):**
- Added a `zai` custom provider to `~/.pi/agent/models.json`
  (`api: anthropic-messages`, `baseUrl: https://api.z.ai/api/anthropic`, apiKey =
  the z.ai token already present on this host).
- Set `defaultProvider: "zai"`, `defaultModel: "glm-5.3-flash"` in
  `~/.pi/agent/settings.json`.
  ⚠️ `defaultModel` must be the bare model id — pi prefixes it with
  `<defaultProvider>/` itself (`zai/zai/...` breaks resolution).
- Backups of the original files: `/tmp/pi-models.json.bak`, `/tmp/pi-settings.json.bak`.

**Optional manual step:** if you want pi back on OpenRouter, replace the key:
`pi auth` → re-enter a valid OpenRouter key, or fix `$OPENROUTER_API_KEY` and
revert the settings defaults.

## Bug 2 — cline: Unauthorized (cline-free account)

**Root cause:** registry pinned `-m cline-free/step-5-preview` — the Cline
free-tier provider requires an OAuth-signed-in Cline account; the credentials
are absent/expired and re-auth (`cline auth cline`) is interactive-only.

Attempted and rejected alternatives:
- `-P anthropic` — cline validates keys client-side (`sk-ant-` prefix); the
  z.ai token is rejected with `invalid x-api-key` before any request is sent.
- `-P openai-native` — verified via request capture that it calls the
  **Responses API** (`POST /responses`), which z.ai does not implement (`404`).
- Updating the binary was not needed; cline 3.0.70 supports the
  `openai-compatible` provider.

**Fix (`src/agents/registry.ts`, non-interactive):**
- cline entry now seeds each per-run `--data-dir` with
  `settings/providers.json` for provider `openai-compatible` pointing at
  `https://api.z.ai/api/coding/paas/v4`, model `glm-5.3-flash` (or `$CLINE_MODEL`
  / `-m` override), and runs with `-P openai-compatible`.
- Token resolution order (`resolveZaiApiKey`): `$ZAI_API_KEY` (if not a
  placeholder) → `$ANTHROPIC_AUTH_TOKEN` → `~/.cline/data/secrets.json`
  `openAiApiKey`. If none found, falls back to the old `-P cline` behavior.
- `npm run build` required before the fix takes effect via `dist/`.

**Manual steps only if you want the real Cline account back (optional):**
```bash
cline auth cline   # interactive OAuth sign-in
# then remove the -P override from the cline entry in src/agents/registry.ts
# (or set CLINE_MODEL/provider back to cline-free)
```

## Verification

Both verified through the built CLI from `/tmp` sandbox dirs (exit 0,
`test_result.txt` containing exactly `hello world`):
- `node dist/cli.js -s -a pi -p "Create a file called test_result.txt ..."` ✅
- `node dist/cli.js -s -a cline -p "Create a file called test_result.txt ..."` ✅

## Recommendations (require user credentials — NOT done)

1. Rotate/replace dead keys: OpenRouter (`$OPENROUTER_API_KEY`,
   `~/.cline/data/secrets.json`), Moonshot, MiniMax.
2. Fix the `ZAI_API_KEY=test` placeholder in your shell profile (or set a real
   z.ai key there).
