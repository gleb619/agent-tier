import { beforeEach, describe, expect, it } from "vitest";
import {
  type ActiveView,
  activeView,
  cycleZone,
  focusZone,
  goToView,
  isTextEntryFocused,
  mainZoneForView,
  setActiveView,
  setFocusZone,
  setSettingsRow,
  setShowPromptOverlay,
  setSidebarFilter,
  setSidebarIndex,
  settingsRow,
  showPromptOverlay,
  sidebarFilter,
  sidebarIndex,
  zonesForView,
} from "../../src/tui2/store/ui";

describe("tui2 ui store", () => {
  beforeEach(() => {
    setActiveView("dashboard");
    setFocusZone("sidebar-list");
    setSidebarFilter("");
    setShowPromptOverlay(false);
    setSettingsRow(0);
    setSidebarIndex(0);
  });

  describe("activeView", () => {
    it("starts on the dashboard", () => {
      expect(activeView()).toBe("dashboard");
    });

    it.each<ActiveView>(["dashboard", "new-task", "run-details", "settings"])("switches to %s", (view) => {
      setActiveView(view);
      expect(activeView()).toBe(view);
    });
  });

  describe("sidebarFilter", () => {
    it("starts empty", () => {
      expect(sidebarFilter()).toBe("");
    });

    it("is settable", () => {
      setSidebarFilter("kimi");
      expect(sidebarFilter()).toBe("kimi");
    });
  });

  describe("goToView", () => {
    it("focuses the prompt textarea when opening New Task", () => {
      setFocusZone("sidebar-list");
      goToView("new-task");
      expect(activeView()).toBe("new-task");
      expect(focusZone()).toBe("prompt");
    });

    it("keeps a sidebar zone when switching between views", () => {
      setFocusZone("sidebar-filter");
      goToView("run-details");
      expect(focusZone()).toBe("sidebar-filter");
    });

    it("relocates focus that does not exist in the target view", () => {
      setFocusZone("log");
      goToView("settings");
      expect(focusZone()).toBe("settings");
    });

    it("falls back to the run list for the dashboard", () => {
      setFocusZone("settings");
      goToView("dashboard");
      expect(focusZone()).toBe("sidebar-list");
    });

    it("clears the prompt overlay on every switch", () => {
      setShowPromptOverlay(true);
      goToView("dashboard");
      expect(showPromptOverlay()).toBe(false);
    });
  });

  describe("focus zones", () => {
    it("treats the filter and prompt as text entry", () => {
      setFocusZone("sidebar-filter");
      expect(isTextEntryFocused()).toBe(true);
      setFocusZone("prompt");
      expect(isTextEntryFocused()).toBe(true);
      setFocusZone("sidebar-list");
      expect(isTextEntryFocused()).toBe(false);
      setFocusZone("log");
      expect(isTextEntryFocused()).toBe(false);
    });

    it("has no main pane zone for the dashboard", () => {
      expect(mainZoneForView("dashboard")).toBe("sidebar-list");
      expect(mainZoneForView("new-task")).toBe("prompt");
      expect(mainZoneForView("run-details")).toBe("log");
      expect(mainZoneForView("settings")).toBe("settings");
    });

    it("only cycles through zones the active view owns", () => {
      expect(zonesForView("dashboard")).toEqual(["sidebar-filter", "sidebar-list"]);
      expect(zonesForView("run-details")).toEqual(["sidebar-filter", "sidebar-list", "log"]);
    });

    it("cycles forward and wraps around", () => {
      setActiveView("run-details");
      setFocusZone("sidebar-filter");
      cycleZone(1);
      expect(focusZone()).toBe("sidebar-list");
      cycleZone(1);
      expect(focusZone()).toBe("log");
      cycleZone(1);
      expect(focusZone()).toBe("sidebar-filter");
    });

    it("cycles backward and wraps around", () => {
      setActiveView("run-details");
      setFocusZone("sidebar-filter");
      cycleZone(-1);
      expect(focusZone()).toBe("log");
    });

    it("restarts from the first zone when focus left the view", () => {
      setActiveView("dashboard");
      setFocusZone("log");
      cycleZone(1);
      expect(focusZone()).toBe("sidebar-list");
    });
  });

  describe("prompt overlay + settings cursor", () => {
    it("toggles the overlay (p / Ctrl+P)", () => {
      setShowPromptOverlay((v) => !v);
      expect(showPromptOverlay()).toBe(true);
      setShowPromptOverlay((v) => !v);
      expect(showPromptOverlay()).toBe(false);
    });

    it("starts the settings cursor on the first row", () => {
      expect(settingsRow()).toBe(0);
      setSettingsRow(3);
      expect(settingsRow()).toBe(3);
    });
  });

  describe("sidebarIndex", () => {
    it("starts on the filter row (index 0)", () => {
      expect(sidebarIndex()).toBe(0);
    });

    it("moves through the flat row model", () => {
      setSidebarIndex(2);
      expect(sidebarIndex()).toBe(2);
      setSidebarIndex(-1);
      expect(sidebarIndex()).toBe(-1);
    });
  });
});
