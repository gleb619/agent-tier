# TUI

Interactive terminal UI for `at`. Launched by no-arg `at` on a TTY. Built on
[opentui](https://github.com/sst/opentui) + Solid (`@opentui/solid`), runs under **Bun**.
Source: [`src/tui`](../src/tui).

> Canonical layout shared with the WebUI: [layout.md](layout.md) — **that file wins**; this doc describes
> the TUI implementation and its remaining gaps (last section). WebUI counterpart: [webui.md](webui.md).
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
|  /  Filter runs…   |   Dashboard | New Task | Run Details | Agents | Settings  |
|  ──────────        |                                                         |
|  ▶ [1] Dashboard   |                                                         |
|    [2] New Task    |                                                         |
|    [3] Run Details |                                                         |
|    [4] Agents      |                                                         |
|    [5] Settings    |                                                         |
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
| agents | `view: agents`, `agents: N`, `disabled: M`, `selected: <name>` |
| settings | run count |

Footer (`footerLine` memo) swaps hints by view and focus zone.

## Views

Target `ActiveView` = the five `ViewId`s of `src/ui-spec.ts` (dashboard, new-task, run-details, agents, settings).
`store/ui.ts` and `MainView.tsx` cover all five; the sidebar menu (`SIDEBAR_MENU_ITEMS` in `components/sidebar/row-model.ts`) is derived
from `NAV_ITEMS` so adding a view needs only a `ui-spec.ts` edit.
`MainView.tsx` is a `<Switch>` over `activeView()`.

### Dashboard (`components/Dashboard.tsx`)

Scrollable single column, order: **Overview → Active runs → Agents → Recent completions** — same panel
order as `docs/layout.md` §2. The Agents panel here is the compact version of the full Agents view; both
share `agents-model.ts` so the health glyph and `runs · success%` line read identically.

- `computeStats(runs)` (pure): total, running, completed, stuck, today, success rate
  (exit 0 / finished with exit code), mean duration of finished runs.
- Active/recent lists capped at `RECENT_LIMIT = 8`, rows via `formatRunRow`.
- Agents panel: health rows from `buildAgentGroups` (registry agents grouped by
  tier, alphabetical, with `AGENT_HEALTH_CONFIG` glyphs).
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

### Agents (`components/Agents.tsx`, `components/agents-model.ts`)

Main-pane cursor over the registry agents, grouped by tier (1..4, spec order).
The renderer-free `agents-model.ts` carries the row derivation, health state,
filter, run counting and the toggle side-effect dispatcher — keeps the
`Agents.tsx` component thin and matches the WebUI's `webui/utils/agents.ts`
split.

- `buildAgentGroups(agents, runStats, health)` (pure, defined per-view via
  `AGENTS` + `countRunsByAgent(filteredSessions2())` + `buildStateReportFor()`).
- `agentHealthState({ deactivated, disabledTo, failures })` mirrors
  `webui/utils/agents.ts#agentHealth`: failing wins over disabled.
- Glyphs: `●` ok / `○` disabled / `✗` failing — same `AGENT_HEALTH_CONFIG`
  shared by both UIs and the Dashboard panel.
- Sidebar filter narrows the agent list (`filterAgentGroupsByQuery`,
  case-insensitive name substring, AND across whitespace tokens).
- Cursor lives in `store/ui.ts` (`agentsSelection`); j/k `Up`/`Down` move it,
  Enter / Space flip the user toggle via `toggleAgentEnabled` (the same
  `setDeactivated` backend `at enable|disable` use), writes go to the
  resolved state dir.
- Tier heading colours: 1 purple `#a371f7`, 2 blue `#58a6ff`, 3 amber
  `#d29922`, 4 gray `#8b949e`. Mirrors `webui/utils/tiers.ts`.
- Main-pane focus zone is `"agents"` — Tab cycles sidebar-filter → sidebar-list
  → agents on this view; `App.tsx` switches on `zone === "agents"` for the
  cursor / toggle keys.

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
- **Filter row** doubles as menu filter: menu items hide unless the query hits label or `NAV_KEYWORDS` (from `src/ui-spec.ts`)
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
| `ui.ts` | `activeView`, `focusZone`, `sidebarIndex`, `sidebarFilter`, `settingsRow`, `showPromptOverlay`, `agentsSelection`; `goToView`, `cycleZone`, `zonesForView`, `mainZoneForView`, `isTextEntryFocused` | focus zones: `sidebar-filter`, `sidebar-list`, `prompt`, `log`, `settings`, `agents` |
| `sessions.ts` | `sessions`, `selectedRunId`, `selectedSession`; `refreshSessions`, `killSession`, `retrySession`, `load/saveSessionState` | joined dirs = `resolveStatusDirs()` (project `.at/` + `~/.at/`, same as `at status`); `runsEqual` skips no-op publishes |
| `filtered-sessions.ts` | `filteredSessions2()` (+ pure `filterRuns`) | function, not module `createMemo` — a memo outside a root would freeze |
| `log.ts` | `logLines`, `scrollOffset`, `autoRefresh`, `filteredLines`, `isLoading`; `loadLogFile`, `refreshLog`, `goToHead/Tail` | log follows the selected run in every view (effect in `App`) |
| `settings.ts` | `tier`, `agent`, `mode`, `retries`; `cycle*`, `load/saveSettings` | `AGENTS_BY_TIER` is derived from the registry (auto first, then registry order); see Gaps only for `loadSettings` accepting tier 4 |
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
| `1` `2` `3` `4` `5` | Dashboard / New Task / Run Details / Agents / Settings; sidebar cursor follows | not in text fields |
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
| `↑`/`↓`/`j`/`k`, `Enter`/`Space` | move cursor / toggle enable | zone `agents` |
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
| `components/agents-model.test.ts` | Agents row model (grouping, health, filter, toggle intent) |

## Sync work (TUI ⇄ WebUI)

Goal: TUI and WebUI look and behave alike ([layout.md](layout.md) §8). Sidebar order is already
**Filter → Navigation → Runs** in the TUI; the WebUI must adopt it (see [webui.md](webui.md)). Both must filter nav
items too (layout.md §1.1). Related board task: T50 (TUI layout parity).

| Spec | TUI today | Needed |
| ---- | --------- | ------ |
| Header `[conn ●] [theme] [?]`, StatusBar `● connected · N active · M runs` | header fields + hint footer | footer left = status, right = hints; conn dot |
| Dashboard: 4 overview cards, success-rate bands (≥80 green, 50–79 amber, <50 red), panel order Overview → Active → Agents → Recent | one-line stats, color only on success card | add Overview cards + reorder Recent/Agents |
| Status glyph/color: `stuck` `!`, `done` green, `stopped` `■` | `⚠`, blue, none | use `STATUS_CONFIG` |
| Tier hues purple/blue/green/amber | plain `tN` | color tier tags |
| Run Details: Retry / Kill / Discuss, Discuss panel, follow toggle | hotkeys only, no Discuss | add Discuss panel (`at discuss list/answer`) + follow toggle |
| New Task: Cancel / Run | `Enter` only | add `Esc`=Cancel, visible `[Run ⏎]` |
| Settings: tier, mode, retries, timeout, Reset / Save | cycle rows, autosave | add timeout row, Reset/Save |

Other rough edges (independent of parity):

- `retrySession` spawns `at -s -p <prompt>` with `stdio: inherit` (garbles raw-mode TUI) and drops agent/tier.
- `killSession` sends raw `SIGKILL` to the pid, no confirmation; prefer `at stop`.
- Unused exports: `filteredSessions`, `showDashboard`, `toggleDashboard` (sessions.ts), `showPrompt` (log.ts).
- Polls state files every 5 s instead of the daemon / `at bridge` path.
- Log window fixed at 20 lines, not terminal-height aware; whole log re-read per poll.
- `/tmp/at-logs` hardcoded for stream-mode logs.
