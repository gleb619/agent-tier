import { describe, expect, it } from "vitest";
import {
  AGENT_HEALTH_CONFIG,
  AGENT_HEALTH_STATES,
  BREAKPOINTS,
  NAV_ITEMS,
  NAV_WIDTH_COLS,
  NAV_WIDTH_PX,
  RUN_STATUSES,
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
