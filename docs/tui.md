# TUI

Interactive terminal UI for `at`. Launched by no-arg `at` on a TTY. Built on
[opentui](https://github.com/sst/opentui) + Solid (`@opentui/solid`), runs under **Bun**.
Source: [`src/tui`](../src/tui).

> Canonical layout shared with the WebUI: [layout.md](layout.md). WebUI counterpart: [webui.md](webui.md).
> Architecture overview: [architecture.md](architecture.md).

## Launch

```
at (no args, TTY)  →  src/cli.ts  →  resolveTuiEntry()  →  spawnTui()
                       bun --preload @opentui/solid/preload src/tui/index.tsx
```

| File | Role |
| ---- | ---- |
| `src/cli.ts` | no-arg + TTY check; errors `TUI requires Bun` if `bun` missing, `TUI timed out` on timeout |
| `src/tui-entry.ts` | `resolveTuiEntry()` (always `src/tui/index.tsx`), `spawnTui()` (`spawnSync`, `stdio: inherit`, 30 min timeout) |
| `src/tui/index.tsx` | `render(() => <App />, { exitOnCtrlC: true })` |

The entry runs the `.tsx` source directly (not `dist/`), so Bun must be installed and `src/` shipped.

## Layout

Header · two-column body · footer. Root column in `App.tsx`; header/footer are `flexShrink={0}`
so they survive a 24-line terminal, the body row takes all remaining height.

```
+------------------------------------------------------------------------------+
| at — agent tier   auto-refresh ON   view: …   <per-view fields>              |  header
+--------------------+---------------------------------------------------------+
| Sidebar (28%)      | MainView (flexGrow)                                     |
|  /  Filter runs…   |   Dashboard | New Task | Run Details | Settings          |
|  ──────────        |                                                         |
|  ▶ [1] Dashboard   |                                                         |
|    [2] New Task    |                                                         |
|    [3] Run Details |                                                         |
|    [4] Settings    |                                                         |
|  ──────────        |                                                         |
|  ── Today ──       |                                                         |
|  ▶ ● run-name      |                                                         |
|      kimi t2 · 42s |                                                         |
+--------------------+---------------------------------------------------------+
| context-sensitive key hints                                                  |  footer
+------------------------------------------------------------------------------+
```

Header fields (`headerFields` memo): title, auto-refresh state, then per view:

| View | Extra fields |
| ---- | ------------ |
| dashboard | total / active / finished |
| new-task | tier / agent / mode |
| run-details | log direction (head/scroll/tail), line window, status, exit code, started/finished, pid, agent, tier |
| settings | run count |

Footer (`footerLine` memo) swaps hints by view and focus zone.

## Views

`ActiveView = "dashboard" | "new-task" | "run-details" | "settings"` (`store/ui.ts`).
`MainView.tsx` is a `<Switch>` over `activeView()`.

### Dashboard (`components/Dashboard.tsx`)

Scrollable single column, order: **Quick stats → Active runs → Recent completions → Agents**.

- `computeStats(runs)` (pure): total, running, completed, stuck, today, success rate
  (exit 0 / finished with exit code), mean duration of finished runs.
- Active/recent lists capped at `RECENT_LIMIT = 8`, rows via `formatRunRow`.
- Agents panel: defaults line + agent health from `buildStateReportFor(stateDirs)` (same report as `at status`),
  rows via `formatAgentRow` (`✓` ok / `✗ … (disabled)`).
- Empty states: `(nothing running)`, `(no finished runs)`, `(no health records)`.
- Respects the sidebar filter (stats computed from `filteredSessions2()`).

### New Task (`components/NewTask.tsx`)

- `<textarea>` prompt. `Enter` submits, `Shift+Enter` newline. `validatePrompt`: trimmed, min 3 chars.
- Selectors (click or hotkey): Tier `^T`, Agent `^A`, Mode `^O`, Retries `^N`. Values from `store/settings.ts`.
- Submit → `launch.ts: submitPrompt` builds `at -p <prompt> -t <tier> [-a agent] [-s] [--retries N]`:
  - `detached` → `spawn("at", args, { detached, stdio: "ignore" })`.
  - `stream` → piped child; stdout/stderr lines pushed into `store/log` and appended to
    `/tmp/at-logs/at-tui-<ts>.log`.
  - Both call `refreshSessions()` after 500 ms.
- Status line under selectors: `launching: tier N · agent · mode` (green) or validation error (amber).

### Run Details (`components/RunDetails.tsx`, `RunMeta.tsx`)

- `RunMeta`: borderless aligned table in a rounded box. Rows built by pure `runMetaRows()`:
  identity (namer name + dim run id; id hidden when unnamed) · agent/tier/pid · status/exit/duration · started range.
  Fixed column widths (`META_VALUE_WIDTH` 14, wide 32).
- Optional **Submitted prompt** panel (`p` / `^P` / click `[show prompt]`), max height 10, scrollable.
- Log: `VISIBLE_LINES = 20` window of `store/log`, numbered `NNNN | line`, tinted by `lineColor`
  (error red · warn amber · info gray · debug dim · success green).
- Running runs auto-pin to tail (`goToTail`).
- Footer strip: log file path, prompt toggle, load indicator `◯`/`●`.
- Empty state: `(no run selected …)` / `(no log output yet)`.

### Settings (`components/Settings.tsx`)

Cursor list over `SETTING_ACTIONS`: Default tier, Default agent, Run mode, Retries, Auto-refresh.
`↑/↓` (or `j/k`) move, `Enter` or click cycles. First four persist; auto-refresh is runtime only.

## Sidebar (`components/Sidebar.tsx`, `sidebar/row-model.ts`)

One flat, uniformly-rendered row list (pure model, no renderer needed):

```
filter → separator → menu rows (1-4) → separator → [group-header → run rows]*
```

- `Row = filter | menu | separator | group-header | run`. Only filter/menu/run are selectable
  (`selectableRowIndices`, `moveSelection` skip visual rows and clamp at the ends).
- **Filter row** doubles as menu filter: menu items hide unless the query hits label or `MENU_KEYWORDS`
  (multi-token = AND). Run filter (`filterRuns`): case-insensitive substring on run id, agent, prompt.
  Editing mounts an `<input>` (`<Show>` on `focusZone === "sidebar-filter"`).
- **Run rows**: two lines — `▶? <icon> <name ≤18>` and `agent tN · duration`. Name = namer output or run id
  (`runLabel`). Date groups via `dateBucket` (Today / Yesterday / `12 Mar`).
- `preserveSidebarIndex`: after each rebuild the cursor follows the same run id (new runs land on top);
  non-run cursors keep their index; unchanged input returns the same index so no signal write.
- Mouse: click run → select + Run Details; click menu → switch view; click filter → edit (stops bubbling).

## State

Solid signals in module scope under `src/tui/store/`. No global store object.

| Store | Signals / API | Notes |
| ----- | ------------- | ----- |
| `ui.ts` | `activeView`, `focusZone`, `sidebarIndex`, `sidebarFilter`, `settingsRow`, `showPromptOverlay`; `goToView`, `cycleZone`, `zonesForView`, `mainZoneForView`, `isTextEntryFocused` | focus zones: `sidebar-filter`, `sidebar-list`, `prompt`, `log`, `settings` |
| `sessions.ts` | `sessions`, `selectedRunId`, `selectedSession`; `refreshSessions`, `killSession`, `retrySession`, `load/saveSessionState` | joined dirs = `resolveStatusDirs()` (project `.at/` + `~/.at/`, same as `at status`); `runsEqual` skips no-op publishes |
| `filtered-sessions.ts` | `filteredSessions2()` (+ pure `filterRuns`) | function, not module `createMemo` — a memo outside a root would freeze |
| `log.ts` | `logLines`, `scrollOffset`, `autoRefresh`, `filteredLines`, `isLoading`; `loadLogFile`, `refreshLog`, `goToHead/Tail` | log follows the selected run in every view (effect in `App`) |
| `settings.ts` | `tier`, `agent`, `mode`, `retries`; `cycle*`, `load/saveSettings` | `AGENTS_BY_TIER` is a hardcoded list (see Gaps) |
| `auto-refresh.ts` | `startSessionAutoRefresh()` | `setInterval` 5000 ms (`SESSION_POLL_MS`) → `refreshSessions` + `refreshLog`; effect restarts on `autoRefresh` toggle |

Data flow:

```
runs.jsonl (project .at/ + ~/.at/) ──refreshRuns (under run lock, stuck/dead detection)──▶ sessions()
                                                                                              │
sidebarFilter ──▶ filteredSessions2() ──▶ Sidebar rows / Dashboard stats / run navigation    │
selectedRunId ──▶ selectedSession() ──▶ log file path ──▶ logLines() ──▶ RunDetails ◀────────┘
```

Persistence (in `<stateDir>/state.json`, key `tui`): `tui.settings = { tier, agent, mode, retries }`,
`tui.selectedRunId`. Writes are best-effort (errors swallowed).

## Keyboard

Handler: single `useKeyboard` in `App.tsx`, `press` events only. Order matters:
Ctrl combos → `Esc` → `Tab` → (stop if text field focused) → view jumps → zone-specific keys.

| Key | Action | Scope |
| --- | ------ | ----- |
| `1` `2` `3` `4` | Dashboard / New Task / Run Details / Settings; sidebar cursor follows | not in text fields |
| `/`, `Ctrl+F` | focus sidebar filter (`isFilterHotkey`) | `Ctrl+F` works inside text fields |
| `Tab` / `Shift+Tab` | cycle zones: filter → list → main pane | all |
| `Esc` | leave text field → sidebar list | text fields (not a quit key) |
| `q`, `Ctrl+Q` | quit (`stopAutoRefresh` + `renderer.destroy()`) | `q` not in text fields |
| `Ctrl+C` | quit (opentui `exitOnCtrlC`) | all |
| `Ctrl+R` | refresh sessions + log | all |
| `Ctrl+T/A/O/N` | cycle tier / agent / mode / retries | all |
| `Ctrl+K` | SIGKILL selected run's pid | all |
| `Ctrl+P` / `p` | toggle prompt panel | Run Details |
| `Ctrl+D` | jump head ⇄ tail of log | Run Details |
| `j`/`k`, `↑`/`↓` | move sidebar cursor (filter → menu → runs) | zone `sidebar-list` |
| `Enter` | activate row: filter → edit, menu → view, run → Run Details | zone `sidebar-list` |
| `r` | retry selected run (`at -s -p <prompt>`) | Run Details |
| `j`/`k`, `↑`/`↓` | scroll log | zone `log` |
| `J`/`K` (Shift) | previous/next run | zone `log` |
| `↑`/`↓`/`j`/`k`, `Enter` | select / change row | zone `settings` |
| `Enter` / `Shift+Enter` | submit / newline | prompt field |

`Quit` must use `renderer.destroy()`, not `stop()` — `stop()` leaves raw mode and the ref'd interval, so the
process never returns to the shell.

## Theme

Colors are inline hex, no token system. Shared constants: `TUI_COLORS` in `format.ts`
(fg `#c9d1d9`, accent `#58a6ff`, ok `#3fb950`, warn `#d29922`, error `#f85149`, border `#555555`);
`Sidebar.tsx` and `RunMeta.tsx` keep their own local copies. Focused panes use cyan/blue border
(`#00aaff` / `#00ddff`), unfocused `#555555`.

Status glyphs (`statusIcon` / `statusColor`):

| Status | Glyph | Color |
| ------ | ----- | ----- |
| running | `●` | green `#3fb950` |
| done | `✓` | blue `#388bfd` |
| failed | `✗` | red `#f85149` |
| stuck | `⚠` | amber `#d29922` |

## Tests

`tests/tui/` (vitest, no renderer — logic is kept in pure helpers):

| Test | Covers |
| ---- | ------ |
| `sidebar-row-model.test.ts` | row model, filter, selection movement, cursor preservation |
| `store-ui.test.ts`, `store/` | zones, view switching, stores |
| `filtered-sessions.test.ts` | `filterRuns` |
| `hotkeys.test.ts` | filter hotkeys |
| `run-list.test.ts`, `run-meta.test.ts` | run formatting, meta rows |
| `launch.test.ts` | `submitPrompt` arg building |
| `layout-structure.test.ts` | layout structure |
| `tui-entry.test.ts` | entry resolution / spawn |

## Parity gaps vs [layout.md](layout.md) / `src/ui-spec.ts`

Spec lists 5 views and a header/status bar; TUI is behind in places. Candidates for follow-up:

| Spec | TUI today |
| ---- | --------- |
| Nav `[4] Agents`, `[5] Settings` | no Agents view; Settings is `[4]`; 4 menu items. Agents only as a Dashboard panel |
| Header with `[conn ●] [theme] [?]` | text-field header, no connection indicator or help overlay |
| StatusBar `● connected · N active · M runs` | footer is key hints only |
| Dashboard overview as 4 cards (+ success-rate color bands) | one-line quick stats, no ≥80/50–79/<50 coloring; layout puts Agents last, spec order is Active → Agents → Recent |
| New Task: Agent and Mode as dropdowns, Cancel/Run buttons | cycle selectors; `Enter` submits, no Cancel |
| Run Details: Retry/Kill/Discuss buttons, Discuss panel, follow toggle | `r` / `^K` hotkeys; **no Discuss panel**; auto-tail only while running |
| Status `stopped` `■`; `stuck` `!` | `stuck` is `⚠`; no `stopped`; `done` is blue not green |
| Tier hues purple/blue/green/amber | tiers shown as plain `tN` text, no color |
| Settings: default tier/mode, retries, timeout, Reset/Save | cycle rows, saved immediately; no timeout row, no Reset |
| Spec consumed from `src/ui-spec.ts` | TUI does not import it; nav/menu hardcoded in `row-model.ts` |

Other known rough edges:

- `AGENTS_BY_TIER` in `store/settings.ts` is hardcoded and stale vs. the registry (e.g. `pi` listed in tier 2,
  now tier 3; `devin` missing). Should read from `src/agents/registry.ts`.
- `loadSettings` casts a tier `4` as `1 | 2 | 3`.
- `retrySession` spawns `at -s -p <prompt>` with `stdio: inherit`, which writes into the raw-mode TUI; it also
  drops the original agent/tier.
- `killSession` sends `SIGKILL` straight to the stored pid (not `at stop`), no confirmation.
- `sessions.ts` still exports unused `filteredSessions`, `showDashboard`, `toggleDashboard` (superseded by
  `filteredSessions2` / `ui.ts`); `log.ts` has unused `showPrompt`.
- Direct state-file reads/polling (5 s) rather than the daemon / `at bridge` path the WebUI uses.
- Log is re-read whole on each poll; window is a fixed 20 lines, not terminal-height aware.
- `/tmp/at-logs` hardcoded for stream-mode logs.
