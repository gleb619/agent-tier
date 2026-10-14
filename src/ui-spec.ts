/** Shared layout specification for TUI (`src/tui/`) and WebUI (`src/webui/`).
 *  Pure data + types; no imports from either UI package and no DOM/opentui dependencies.
 *  Keep in sync with `docs/layout.md`. */

export type ViewId = "dashboard" | "new-task" | "run-details" | "agents" | "settings";

export interface Section {
  id: string;
  title: string;
}

export interface NavItem {
  id: ViewId;
  label: string;
  shortcut: number;
}

export interface StatusEntry {
  token: string;
  glyph: string;
  sort: number;
}

export interface HealthEntry {
  token: string;
  glyph: string;
}

export interface TierEntry {
  label: string;
  role: string;
  token: string;
}

export interface Breakpoint {
  name: "sm" | "md" | "lg";
  minPx: number;
}

/** Ordered views shared by both UIs. */
export const VIEWS = [
  { id: "dashboard", title: "Dashboard" },
  { id: "new-task", title: "New Task" },
  { id: "run-details", title: "Run Details" },
  { id: "agents", title: "Agents" },
  { id: "settings", title: "Settings" },
] as const satisfies ReadonlyArray<{ id: ViewId; title: string }>;

/** Navigation sidebar items, in the same order as the views. */
export const NAV_ITEMS = [
  { id: "dashboard", label: "Dashboard", shortcut: 1 },
  { id: "new-task", label: "New Task", shortcut: 2 },
  { id: "run-details", label: "Run Details", shortcut: 3 },
  { id: "agents", label: "Agents", shortcut: 4 },
  { id: "settings", label: "Settings", shortcut: 5 },
] as const satisfies ReadonlyArray<NavItem>;

/** Per-view section lists. Order is the render order in both UIs. */
export const SECTIONS = {
  dashboard: [
    { id: "overview", title: "Overview" },
    { id: "active-runs", title: "Active runs" },
    { id: "agents", title: "Agents" },
    { id: "recent-completions", title: "Recent completions" },
  ],
  "new-task": [
    { id: "prompt", title: "Prompt" },
    { id: "config", title: "Configuration" },
    { id: "actions", title: "Actions" },
  ],
  "run-details": [
    { id: "meta", title: "Run meta" },
    { id: "log", title: "Log" },
    { id: "discuss", title: "Discuss" },
  ],
  agents: [
    { id: "header", title: "Agents header" },
    { id: "tier-groups", title: "Tier groups" },
  ],
  settings: [
    { id: "form", title: "Settings" },
    { id: "actions", title: "Actions" },
  ],
} as const satisfies Record<ViewId, ReadonlyArray<Section>>;

/** Sidebar width in terminal columns (TUI) and pixels (WebUI). */
export const NAV_WIDTH_COLS = 28 as const;
export const NAV_WIDTH_PX = 256 as const;

/** Responsive breakpoints used by the WebUI. TUI ignores these. */
export const BREAKPOINTS = [
  { name: "sm", minPx: 640 },
  { name: "md", minPx: 768 },
  { name: "lg", minPx: 1024 },
] as const satisfies ReadonlyArray<Breakpoint>;

/** Run statuses emitted by `at status`. These are the canonical values both UIs render. */
export const RUN_STATUSES = ["running", "done", "failed", "stuck"] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

/** Status vocabulary: semantic token name, shared glyph, and sort order.
 *  UIs map the token to their own palette (hex values live in the UI layer). */
export const STATUS_CONFIG = {
  running: { token: "status-running", glyph: "●", sort: 0 },
  done: { token: "status-done", glyph: "✓", sort: 1 },
  failed: { token: "status-failed", glyph: "✗", sort: 2 },
  stuck: { token: "status-stuck", glyph: "!", sort: 3 },
  stopped: { token: "status-stopped", glyph: "■", sort: 4 },
} as const satisfies Record<RunStatus | "stopped", StatusEntry>;

/** Tier values and vocabulary. */
export const TIERS = [1, 2, 3, 4] as const;
export type Tier = (typeof TIERS)[number];

export const TIER_CONFIG = {
  1: { label: "Tier 1", role: "architect / review", token: "tier-1" },
  2: { label: "Tier 2", role: "dev / QA", token: "tier-2" },
  3: { label: "Tier 3", role: "experimental / boilerplate", token: "tier-3" },
  4: { label: "Tier 4", role: "dry-run / test agents", token: "tier-4" },
} as const satisfies Record<Tier, TierEntry>;

/** Agent health states shared by the run list and agents view. */
export const AGENT_HEALTH_STATES = ["ok", "disabled", "failing"] as const;
export type AgentHealthState = (typeof AGENT_HEALTH_STATES)[number];

export const AGENT_HEALTH_CONFIG = {
  ok: { token: "health-ok", glyph: "●" },
  disabled: { token: "health-disabled", glyph: "○" },
  failing: { token: "health-failing", glyph: "✗" },
} as const satisfies Record<AgentHealthState, HealthEntry>;
