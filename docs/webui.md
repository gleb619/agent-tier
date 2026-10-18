# WebUI

Browser UI for `at`, served by `at web`. Svelte 4 + Vite + Tailwind, source in
[`src/webui`](../src/webui) (a pnpm workspace member with its own
`package.json`; deps install via the root `pnpm install`).

> Layout (shared with the TUI): see [layout.md](layout.md). Architecture overview: [docs/architecture.md](architecture.md).

## Sidebar (parity with TUI)

Order is fixed: **Filter (top) → Navigation → Run list** ([layout.md](layout.md) §1, §1.1). The single filter box
(`/` when no text field has focus, `Ctrl+F` always) filters nav items (label + `NAV_KEYWORDS` from `src/ui-spec.ts`)
*and* runs; `Esc` inside it blurs. `layout/Sidebar.svelte` hoists `FilterInput` above `Navigation` (hidden while the
sidebar is collapsed) and `RunList` no longer owns it; `Navigation` renders `visibleNavItems`, number keys still work
when a row is filtered out. Sidebar width is the spec's 256px (`NAV_WIDTH_PX`), nav has 5 items: `[1]` Dashboard,
`[2]` New Task, `[3]` Run Details, `[4]` Agents, `[5]` Settings — order, labels and shortcuts come from `NAV_ITEMS`.
Status glyphs/tier colors per layout.md §7. Remaining parity gap: the TUI still has 4 nav items (no Agents view);
drive its menu from `NAV_ITEMS` and add the view.

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

Endpoint contract tests (`tests/bridge-schema.test.ts`) and Go stub tests (`web-server/internal/proxy/proxy_test.go`) assert envelope shapes and error mapping. See `docs/bridge.md`.

## API

The Go server `web-server/internal/proxy` is a thin HTTP+static+SSE proxy:
every request is translated to one `at bridge <resource> <verb> [id]` call
(JSON in/out, see [docs/bridge.md](bridge.md)). Endpoints that have no bridge
verb yet fall through to a small direct `at` shim (the bridge is the
source of truth; the shims will move into bridge verbs in later tasks).

| Endpoint | Bridge path | Notes |
| :------- | :---------- | :----- |
| `GET /api/runs` | `runs list` | joined state dirs (`at bridge` resolves) |
| `POST /api/runs` | spawn `at -p ... -a ... -t ... -s` | direct shim; awaiting a `runs create` bridge verb |
| `GET /api/runs/:id` | `runs get` | |
| `GET /api/usage` | `usage summary` | time consumed + kanban planned-vs-consumed |
| `DELETE /api/runs/:id` | `runs stop` | `?force=1` propagates as `{force:true}` |
| `POST /api/runs/:id/retry` | `runs get` + spawn | direct shim; reads stored prompt/agent/tier |
| `GET /api/runs/:id/log?lines=N` | `runs get` + tail file | direct; `lines` defaults to 200 |
| `GET /api/runs/:id/discuss` | `discuss list` | `?pending=1` → unanswered only |
| `POST /api/runs/:id/discuss` | `discuss answer`/`say` | `kind:"answer"` carries `replyTo` |
| `GET /api/events[/:runId]` | `events tail` | SSE replay; live fan-out ships with the daemon (T33+) |
| `GET /api/agents` | `agents list` | |
| `PUT /api/agents/:name/enable\|disable` | exec `at enable\|disable` | direct shim |
| `GET /api/stats` | `runs list` + `agents health` | computed in Go |
| `GET /api/ping` | `ping ping` | smoke check |
| `GET /api/health` | `health get` | scheduler state block |
| `GET /api/settings` | read `<stateDir>/web-settings.json` | direct shim; awaiting a `settings get` verb |
| `PUT /api/settings` | atomic write to the same file | direct shim |

Any bridge error envelope (`USAGE`, `NOT_FOUND`, `CONFLICT`, `INVALID`, …)
maps to the closest HTTP status; envelopes with no machine code (timeout,
exec failure, malformed stdout) become `502 Bad Gateway`. The `at` binary is
resolved via `AT_BIN` (defaults to `at`); `at-web` itself never reads or
modifies the state dirs directly.

Any non-`/api` path falls back to the SPA shell (`index.html`).

## Develop

```bash
pnpm run build:go     # build the Go backend into bin/at-web (skips if go is missing)
pnpm run web:dev      # vite dev server on :3000, proxies /api → at web :7800
pnpm run web:build    # production build into src/webui/dist
pnpm run web:analyze  # build + per-chunk size report vs budgets (exit 1 over budget)
pnpm run web:check    # svelte-check against tsconfig.webui.json
```

Start the API alongside (`at web`) for a live backend; without it the dev
server only serves the frontend.

## Performance

Build-time (`src/webui/plugins/perf.ts`, runs at the end of `vite build`):

- Injects resource hints into `index.html`: `modulepreload` for the entry
  chunk and its static imports, `prefetch` for the lazy view chunks.
- Writes precompressed `.br` (brotli q11) / `.gz` siblings for every text
  asset (html/js/css/svg/manifest/maps), so the server never compresses.
- The SW precache manifest excludes the `.br`/`.gz` siblings.

Runtime (`src/webui/utils/prefetch.ts`):

- Nav buttons prefetch their view chunk on hover/focus; all lazy views are
  prefetched at low priority via `requestIdleCallback` after boot.
- SSE refetches are debounced 100ms trailing (`src/webui/utils/debounce.ts`),
  so a burst of start/done events collapses into one `GET /api/runs`.

Server (`web-server/internal/static`):

- Content negotiation: serves `.br`/`.gz` variants by `Accept-Encoding`
  q-value (br preferred on ties), with `Vary: Accept-Encoding`, `ETag` and
  304 revalidation on the served representation. `at-web` itself speaks
  HTTP/1.1; run it behind a TLS-terminating proxy to get HTTP/2 — the
  precompressed variants keep paying off either way.

Budgets (enforced by `tests/webui-budget.test.ts` against the built dist):

| Metric (gzip)                    | Budget  | Measured |
| :------------------------------- | :------ | :------- |
| Initial load (shell + entry graph) | < 100kB | ~27kB    |
| Total JS incl. lazy views (§13.2)  | < 200kB | ~46kB    |

`pnpm run web:analyze` prints the same numbers per chunk. Fonts: the UI uses
a system font stack — no webfonts to subset or self-host.

## PWA E2E + Lighthouse gate

`tests/e2e/webui/pwa.test.ts` (runs under `pnpm run test:e2e`, one worker)
proves the PWA behaviors against a real `at web` server + headless chromium:

- service worker registers, activates, and controls the page; manifest is
  linked and installable (name, `display: standalone`, 192/512px icons)
- offline reload serves the app shell from the precache (`index.html` fallback)
- run creation while offline is queued by the SW (202 + `queued: true`) and
  replayed to `POST /api/runs` when back online
- deep links (`/settings`, …) render their view directly — server-side SPA
  fallback online, precached shell + router offline
- SW update flow: a bumped `sw.js` triggers the "Update available" toast;
  the Reload action posts `SKIP_WAITING` and the new worker takes control

`pnpm run web:lighthouse` boots the prod build on a random port and runs the
gate defined in `scripts/lighthouse.config.json`:

- Lighthouse (desktop preset, Playwright chromium via `CHROME_PATH`):
  **performance >= 0.90**
- PWA installability asserted by `scripts/pwa-installable.ts` (Lighthouse 13
  dropped its PWA category): manifest link, installable fields, real icon
  responses, and a caching service worker at `/sw.js`

Thresholds live in `scripts/lighthouse.config.json`; the full LHR JSON is
written to `$TMPDIR/at-webui-lighthouse-report.json`. The gate is kept out of
`pnpm run test:e2e` (it is slower and needs Chrome) — run it on demand.

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
