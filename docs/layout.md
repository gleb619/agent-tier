# UI Layout (TUI + WebUI)

Canonical layout both UIs follow. TUI (`src/tui`, opentui) and WebUI (`src/webui`, Svelte) share the
same **structure, nav order, sections and status/tier vocabulary**; they differ only in rendering
(cells vs. pixels). Any layout change updates this file first. Spec source of truth in code:
`src/ui-spec.ts` (task T49); parity enforced by tests (task T50).

Related: [webui.md](webui.md) · [architecture.md](architecture.md) · [progress.md](progress.md) · [kanban.md](kanban.md)

## 1. Shell

```
+--------------------------------------------------------------------------------+
| Header   at · agent-tier                                  [conn ●] [theme] [?] |
+-------------------+------------------------------------------------------------+
| SIDEBAR           | MAIN VIEW                                                  |
|                   |                                                            |
| / Filter: [_____] |   (one of: Dashboard / New Task / Run Details /            |
|                   |    Agents / Settings)                                      |
| Navigation        |                                                            |
|  [1] Dashboard    |                                                            |
|  [2] New Task     |                                                            |
|  [3] Run Details  |                                                            |
|  [4] Agents       |                                                            |
|  [5] Settings     |                                                            |
|                   |                                                            |
| Runs              |                                                            |
|  ● run-name   t2  |                                                            |
|  ✓ run-name   t1  |                                                            |
|  ✗ run-name   t3  |                                                            |
+-------------------+------------------------------------------------------------+
| StatusBar  ● connected · 2 active · 14 runs                    keys: 1-5 ? q   |
+--------------------------------------------------------------------------------+
```

* Sidebar order is fixed: **Filter (top) → Navigation → Run list** (scrolls, date-grouped, bulk-select in WebUI).
  The filter sits above everything it filters; see §1.1.
* Sidebar width: TUI ~28 cols; WebUI 256px, collapses to a drawer below `md`.
* Nav shortcuts are identical in both UIs: `1` Dashboard, `2` New Task, `3` Run Details,
  `4` Agents, `5` Settings. Focus zones: sidebar filter → sidebar list → main (`Tab` / `Shift+Tab`).
* Header and StatusBar exist in both UIs. TUI: header = title + auto-refresh + view fields, footer = StatusBar
  (connection/active/runs on the left, key hints on the right). WebUI: `Header.svelte`, `StatusBar.svelte`.

### 1.1 Sidebar filter

One query box, always the first sidebar row, filters **both** the navigation items and the run list.

* Nav item matches when every whitespace-separated token is a substring of its label or one of its keywords
  (`NAV_KEYWORDS` in `src/ui-spec.ts`, shared by both UIs). Empty query shows all nav items.
* Run matches when every token is a substring of run id, name, agent or prompt (case-insensitive).
* Non-matching rows are hidden, not dimmed. Group headers with no runs are hidden. Filter row never hides.
* If a hidden nav item is the active view, the view stays; only the sidebar entry is hidden.
* Number shortcuts (`1`–`5`) keep working regardless of the filter.
* Focus: `/` (when no text field has focus) or `Ctrl+F` (always) focuses the filter in the TUI;
  WebUI binds `/` and `Ctrl+F` the same way. `Esc` clears focus (first press), then leaves the field.
* `Enter` in the filter with one visible nav item opens it; with none and one visible run opens that run.

## 2. Dashboard

```
+----------------------------------------------------------------------+
| Overview                                                             |
| +-------------+ +-------------+ +-------------+ +-------------+      |
| | Total runs  | | Active      | | Success     | | Avg time    |      |
| | 128  ↑ 12   | | 2           | | 44%  ▼ red  | | 3m 12s ↓    |      |
| +-------------+ +-------------+ +-------------+ +-------------+      |
| Time            time 3h20m · 128 finished runs                       |
|   over budget 2 · time 78% of plan                                   |
+----------------------------------+-----------------------------------+
| Active runs                      | Agents                            |
|  ● fix-auth      kimi   02:11    |  tier 1  glm-code  codex   kimi   |
|  ● add-tests     qwen   00:47    |  tier 2  mm-code   opencode ...   |
|  (empty → "No active runs"       |  tier 3  kilo      agy     ...    |
|   [ New Task ])                  |  ● ok  ○ disabled  ✗ failing      |
+----------------------------------+-----------------------------------+
| Recent completions            [sort: time ▾] [status ▾]              |
|  ✓ refactor-db    codex  t1  ▇▇▇▇▇░░ 4m                             |
|  ✗ lint-pass      pi     t2  ▇▇░░░░░ 1m                             |
+----------------------------------------------------------------------+
```

Panels (order fixed): Overview cards · Active runs · Agents · Recent completions.
Success-rate card color: ≥80% green, 50–79% amber, <50% red.

## 3. New Task

```
+----------------------------------------------------------------------+
| New Task                                                             |
| Prompt   +------------------------------------------------------+    |
|          |                                                      |    |
|          +------------------------------------------------------+    |
| Tier [auto ▾]   Agent [auto ▾]   Mode [detached ▾]   Retries [3]     |
|                                              [ Cancel ]  [ Run ⏎ ]   |
+----------------------------------------------------------------------+
```

## 4. Run Details

```
+----------------------------------------------------------------------+
| ● fix-auth                      kimi · t2 · running · 02:11          |
| id 8f3a… · started 19:02 · cwd ~/proj          [Retry] [Kill] [Discuss]|
| time 12m                                                             |
| T9 time 20m / est 30m (-33%)                                         |
+----------------------------------------------------------------------+
| Log                                                  [follow ✓] [⤓]  |
| 19:02:11 starting…                                                   |
| 19:02:14 tool: edit src/auth.ts                                      |
| …                                                                    |
+----------------------------------------------------------------------+
| Discuss  (agent ⇄ host)                                              |
|  agent> Which token store?                       reply: [________]   |
+----------------------------------------------------------------------+
```

## 5. Agents

```
+----------------------------------------------------------------------+
| Agents                                          [filter ____] [tier ▾]|
| Tier 1 — architect / review                                          |
|  +-------------------+ +-------------------+ +-------------------+   |
|  | glm-code   ● ok   | | codex     ● ok    | | kimi    ✗ failing |   |
|  | 12 runs · 92%     | | 30 runs · 88%     | | 5 runs · 20%      |   |
|  | [x] Enabled       | | [x] Enabled       | | [ ] Enabled       |   |
|  +-------------------+ +-------------------+ +-------------------+   |
| Tier 2 — dev / QA   …                                                |
+----------------------------------------------------------------------+
```

## 6. Settings

```
+----------------------------------------------------------------------+
| Settings                                                             |
|  Default tier   [2 ▾]     Default mode  [detached ▾]                 |
|  Retries        [3]       Timeout (ms)  [3600000]                    |
|                                              [ Reset ]  [ Save ]     |
+----------------------------------------------------------------------+
```

## 7. Shared vocabulary

| Concept | Values | TUI | WebUI |
| ------- | ------ | --- | ----- |
| Status | running / done / failed / stuck / stopped | `●` yellow / `✓` green / `✗` red / `!` amber / `■` gray (TUI used `⚠` and blue `done`; must match this row) | same glyph + badge color |
| Tier | 1 architect · 2 dev/QA · 3 experimental · 4 mock | purple / blue / green / amber | same hues (design tokens) |
| Agent health | ok / disabled / failing | `●` `○` `✗` | badge + toggle |

## 8. Parity rules

* Same nav items, order, shortcuts and panel order (sections 1–6).
* Same sidebar order and filter semantics (§1, §1.1): filter on top, filters nav and runs.
* Same status/tier colors and glyphs (section 7).
* WebUI-only extras (drawer, hover tooltips, bulk select, PWA) must not change structure.
* TUI-only constraints (no pointer, fixed grid) may drop decoration, never a section.

## 9. Machine-readable spec

`src/ui-spec.ts` is the executable counterpart of this document: view ids, ordered
sections per view, layout tokens (nav widths, breakpoints), and the shared
status/tier/health vocabulary. Both TUI and WebUI consume it; keep this file and
the spec in sync.
