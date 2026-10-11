# WebUI

Browser UI for `at`, served by `at web`. Svelte 4 + Vite + Tailwind, source in
[`src/webui`](../src/webui) (a pnpm workspace member with its own
`package.json`; deps install via the root `pnpm install`).

## Run

```bash
pnpm run build     # root build = tsc (dist/) + vite build (src/webui/dist)
at web             # serves REST + SSE + the built WebUI on http://127.0.0.1:7800
```

`at web` serves the built app from `<package root>/src/webui/dist` when present
(API-only mode otherwise). Flags:

- `-p, --port <n>` — port (default 7800, 0 = random)
- `--host <addr>` — bind address (default `127.0.0.1`; use `0.0.0.0` in containers)
- `--static <dir>` — serve a different WebUI build dir
- `--state-dir <dir>` — state dirs, same resolution as `at status` by default

## API

Implemented by `src/web/server.ts` (single-file Node http server, no framework):

| Endpoint | Description |
| :------- | :---------- |
| `GET /api/runs` | joined run list from all state dirs |
| `POST /api/runs` | launch a run (`{prompt, agent?, tier?, cwd?}`) |
| `GET/DELETE /api/runs/:id` | run record; DELETE kills (`?force=1` → SIGKILL) |
| `POST /api/runs/:id/retry` | relaunch with same prompt/agent/tier |
| `GET /api/runs/:id/log?lines=N` | log tail (default 200 lines) |
| `GET/POST /api/runs/:id/discuss` | discuss thread (proxied to the notify hub) |
| `GET /api/events[/:runId]` | SSE proxy onto the notify hub stream |
| `GET /api/agents`, `GET /api/stats` | registry + health, aggregate stats |
| `GET/PUT /api/settings` | `web-settings.json` defaults |

Any non-`/api` path falls back to the SPA shell (`index.html`).

## Develop

```bash
pnpm run web:dev     # vite dev server on :3000, proxies /api → at web :7800
pnpm run web:build   # production build into src/webui/dist
pnpm run web:check   # svelte-check against tsconfig.webui.json
```

Start the API alongside (`at web`) for a live backend; without it the dev
server only serves the frontend.

## Docker

```bash
docker build -t at .
docker run --rm -p 7800:7800 at
```

Multi-stage `Dockerfile`: deps + root build in `node:22-bookworm-slim`, runtime
stage copies `dist/`, `node_modules/` and `src/webui/dist/` only. The image
entrypoint is `node dist/cli.js web --port 7800 --host 0.0.0.0`.
