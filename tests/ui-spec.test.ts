import { describe, expect, it } from "vitest";
import {
  AGENT_HEALTH_CONFIG,
  AGENT_HEALTH_STATES,
  BREAKPOINTS,
  NAV_ITEMS,
  NAV_KEYWORDS,
  NAV_WIDTH_COLS,
  NAV_WIDTH_PX,
  navMatchesQuery,
  RUN_STATUSES,
  runMatchesQuery,
  SECTIONS,
  STATUS_CONFIG,
  TIER_CONFIG,
  TIERS,
  VIEWS,
} from "../src/ui-spec";

describe("ui-spec", () => {
  it("lists every shared view with a unique title", () => {
    expect(VIEWS.length).toBeGreaterThan(0);
    const titles = VIEWS.map((view) => view.title);
    expect(new Set(titles).size).toBe(titles.length);
  });

  it("nav items mirror views with unique, sequential shortcuts", () => {
    expect(NAV_ITEMS.length).toBe(VIEWS.length);

    const shortcuts = NAV_ITEMS.map((item) => item.shortcut);
    expect(new Set(shortcuts).size).toBe(shortcuts.length);

    NAV_ITEMS.forEach((item, index) => {
      expect(item.id).toBe(VIEWS[index].id);
      expect(item.label).toBe(VIEWS[index].title);
      expect(item.shortcut).toBe(index + 1);
    });
  });

  it("every view has at least one section", () => {
    for (const view of VIEWS) {
      const sections = SECTIONS[view.id];
      expect(sections, `sections for ${view.id}`).toBeDefined();
      expect(sections.length, `sections for ${view.id}`).toBeGreaterThan(0);
    }
  });

  it("section ids are unique within each view", () => {
    for (const [viewId, sections] of Object.entries(SECTIONS)) {
      const seen = new Set<string>();
      for (const { id } of sections) {
        expect(seen.has(id), `duplicate section id ${id} in ${viewId}`).toBe(false);
        seen.add(id);
      }
    }
  });

  it("layout tokens are positive and breakpoints are ordered", () => {
    expect(NAV_WIDTH_COLS).toBeGreaterThan(0);
    expect(NAV_WIDTH_PX).toBeGreaterThan(0);

    let previous = 0;
    for (const breakpoint of BREAKPOINTS) {
      expect(breakpoint.minPx).toBeGreaterThan(previous);
      previous = breakpoint.minPx;
    }
  });

  it("status config covers the frozen run-status list", () => {
    for (const status of RUN_STATUSES) {
      expect(STATUS_CONFIG[status], `status ${status}`).toBeDefined();
    }
  });

  it("status entries have non-empty tokens, glyphs and unique sort values", () => {
    const seenSorts: number[] = [];
    for (const entry of Object.values(STATUS_CONFIG)) {
      expect(entry.token.length).toBeGreaterThan(0);
      expect(entry.glyph.length).toBeGreaterThan(0);
      expect(entry.sort).toBeGreaterThanOrEqual(0);
      expect(seenSorts.includes(entry.sort)).toBe(false);
      seenSorts.push(entry.sort);
    }
  });

  it("tier config covers every tier with non-empty tokens", () => {
    for (const tier of TIERS) {
      const config = TIER_CONFIG[tier];
      expect(config, `tier ${tier}`).toBeDefined();
      expect(config.token.length).toBeGreaterThan(0);
      expect(config.label.length).toBeGreaterThan(0);
    }
  });

  it("agent health config covers every health state", () => {
    for (const state of AGENT_HEALTH_STATES) {
      expect(AGENT_HEALTH_CONFIG[state], `health ${state}`).toBeDefined();
    }
  });
});

describe("navMatchesQuery", () => {
  it("covers every view with keyword aliases", () => {
    for (const view of VIEWS) {
      expect(NAV_KEYWORDS[view.id], `keywords for ${view.id}`).toBeDefined();
      expect(NAV_KEYWORDS[view.id].length, `keywords for ${view.id}`).toBeGreaterThan(0);
    }
  });

  it("matches everything on a blank or whitespace-only query", () => {
    for (const item of NAV_ITEMS) {
      expect(navMatchesQuery(item.id, item.label, "")).toBe(true);
      expect(navMatchesQuery(item.id, item.label, "   \t ")).toBe(true);
    }
  });

  it("matches a substring of the label, case-insensitively", () => {
    expect(navMatchesQuery("dashboard", "Dashboard", "dash")).toBe(true);
    expect(navMatchesQuery("dashboard", "Dashboard", "DASH")).toBe(true);
    expect(navMatchesQuery("dashboard", "Dashboard", "setting")).toBe(false);
  });

  it("matches a keyword alias rather than the label", () => {
    expect(navMatchesQuery("settings", "Settings", "retries")).toBe(true);
    expect(navMatchesQuery("settings", "Settings", "sandbox")).toBe(true);
    expect(navMatchesQuery("dashboard", "Dashboard", "history")).toBe(true);
    expect(navMatchesQuery("run-details", "Run Details", "log")).toBe(true);
    expect(navMatchesQuery("new-task", "New Task", "submit")).toBe(true);
  });

  it("gives the agents view its own aliases", () => {
    expect(navMatchesQuery("agents", "Agents", "health")).toBe(true);
    expect(navMatchesQuery("agents", "Agents", "enable")).toBe(true);
    expect(navMatchesQuery("agents", "Agents", "disable")).toBe(true);
    expect(navMatchesQuery("agents", "Agents", "tier")).toBe(true);
    expect(navMatchesQuery("agents", "Agents", "sandbox")).toBe(false);
  });

  it("ANDs multi-token queries across tokens", () => {
    // "new task" — both tokens hit the New Task label.
    expect(navMatchesQuery("new-task", "New Task", "new task")).toBe(true);
    expect(navMatchesQuery("dashboard", "Dashboard", "new task")).toBe(false);
    // Tokens may land on different fields of the same item (label + keyword).
    expect(navMatchesQuery("settings", "Settings", "setting timeout")).toBe(true);
    expect(navMatchesQuery("settings", "Settings", "setting runs")).toBe(false);
    // Extra whitespace between tokens is ignored.
    expect(navMatchesQuery("new-task", "New Task", "  new   task  ")).toBe(true);
  });
});

describe("runMatchesQuery", () => {
  const run = {
    runId: "8f3a12",
    name: "fix-auth",
    agent: "kimi",
    prompt: "fix the flaky test",
  };

  it("matches everything on a blank or whitespace-only query", () => {
    expect(runMatchesQuery(run, "")).toBe(true);
    expect(runMatchesQuery(run, "  \t ")).toBe(true);
  });

  it("matches on run id, name, agent or prompt", () => {
    expect(runMatchesQuery(run, "8f3a")).toBe(true);
    expect(runMatchesQuery(run, "auth")).toBe(true);
    expect(runMatchesQuery(run, "kim")).toBe(true);
    expect(runMatchesQuery(run, "flaky")).toBe(true);
    expect(runMatchesQuery(run, "nope")).toBe(false);
  });

  it("is case-insensitive", () => {
    expect(runMatchesQuery(run, "KIMI")).toBe(true);
    expect(runMatchesQuery(run, "Fix The")).toBe(true);
  });

  it("ANDs multi-token queries, each token free to hit a different field", () => {
    expect(runMatchesQuery(run, "kimi flaky")).toBe(true);
    expect(runMatchesQuery(run, "8f3a fix-auth kimi flaky")).toBe(true);
    expect(runMatchesQuery(run, "kimi kanban")).toBe(false);
  });

  it("tolerates a run without a resolved name", () => {
    const unnamed = { runId: "abc", agent: "qwen", prompt: "retry me" };
    expect(runMatchesQuery(unnamed, "abc")).toBe(true);
    expect(runMatchesQuery(unnamed, "qwen retry")).toBe(true);
    expect(runMatchesQuery(unnamed, "name")).toBe(false);
  });
});
