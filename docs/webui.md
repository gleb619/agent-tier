# WebUI

Browser UI for `at`, served by `at web`. Svelte 4 + Vite + Tailwind, source in
[`src/webui`](../src/webui) (a pnpm workspace member with its own
`package.json`; deps install via the root `pnpm install`).

## Run

```bash
pnpm run build     # root build = tsc (dist/) + vite build (src/webui/dist) + Go backend (bin/at-web)
at web             # serves REST + SSE + the built WebUI on http://127.0.0.1:7800
```

`at web` now launches the Go backend `at-web` (`web-server/cmd/at-web`). The
binary is resolved in this order:

1. `AT_WEB_BIN` environment variable
2. `<package root>/bin/at-web` (built by `pnpm run build:go`)
3. `at-web` found in `PATH`

If no binary is found, the command prints a build hint and exits.

`at web` serves the built app from `<package root>/src/webui/dist` when present
(API-only mode otherwise). Flags:

- `-p, --port <n>` — port (default 7800, 0 = random)
- `--host <addr>` — bind address (default `127.0.0.1`; use `0.0.0.0` in containers)
- `--static <dir>` — serve a different WebUI build dir
- `--state-dir <dir>` — state dirs, same resolution as `at status` by default

## API

Implemented by the Go server `web-server/internal/api`:

| Endpoint | Description |
| :------- | :---------- |
| `GET /api/runs` | joined run list from all state dirs |
| `POST /api/runs` | launch a run (`{prompt, agent?, tier?, cwd?}`) |
| `GET/DELETE /api/runs/:id` | run record; DELETE kills (`?force=1` → SIGKILL) |
| `POST /api/runs/:id/retry` | relaunch with same prompt/agent/tier |
| `GET /api/runs/:id/log?lines=N` | log tail (default 200 lines) |
| `GET/POST /api/runs/:id/discuss` | discuss thread (proxied to the event hub) |
| `GET /api/events[/:runId]` | SSE replay/live stream |
| `GET /api/agents`, `GET /api/stats` | registry + health, aggregate stats |
| `GET/PUT /api/settings` | `web-settings.json` defaults |

Any non-`/api` path falls back to the SPA shell (`index.html`).

## Develop

```bash
pnpm run build:go     # build the Go backend into bin/at-web (skips if go is missing)
pnpm run web:dev      # vite dev server on :3000, proxies /api → at web :7800
pnpm run web:build    # production build into src/webui/dist
pnpm run web:check    # svelte-check against tsconfig.webui.json
```

Start the API alongside (`at web`) for a live backend; without it the dev
server only serves the frontend.

## Docker

```bash
docker build -t at .
docker run --rm -p 7800:7800 at
```

Multi-stage `Dockerfile`:

- `build` stage (Node) installs deps and runs `pnpm run build` (TypeScript +
  WebUI; the Go step is skipped when the Node image has no Go toolchain).
- `go-builder` stage (Go) builds `at-web`.
- Runtime stage copies `dist/`, `node_modules/`, `src/webui/dist/` and
  `bin/at-web`, then runs `node dist/cli.js web --port 7800 --host 0.0.0.0`.

## Publish

`bin/at-web` is built on demand and is listed in `.gitignore`. If you add a
`files` array to `package.json`, remember to include `bin/at-web` and
`src/webui/dist` so that published installs can run `at web` out of the box.
