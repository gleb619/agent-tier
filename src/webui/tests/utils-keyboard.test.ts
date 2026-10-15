import { describe, expect, it, vi } from "vitest";
import type { ApiRun } from "../types/api";
import {
  handleKeydown,
  isFormField,
  type KeyboardHandlers,
  keyboardShortcuts,
  neighborRunId,
  resolveShortcut,
} from "../utils/keyboard";

function keyEvent(key: string, mods: { ctrl?: boolean; alt?: boolean; meta?: boolean } = {}): KeyboardEvent {
  return new KeyboardEvent("keydown", {
    key,
    ctrlKey: mods.ctrl ?? false,
    altKey: mods.alt ?? false,
    metaKey: mods.meta ?? false,
    cancelable: true,
  });
}

function noopHandlers(): KeyboardHandlers {
  return {
    navigateTo: vi.fn(),
    selectNextRun: vi.fn(),
    selectPreviousRun: vi.fn(),
    openSelectedRun: vi.fn(),
    retrySelectedRun: vi.fn(),
    killSelectedRun: vi.fn(),
    showPrompt: vi.fn(),
    focusFilter: vi.fn(),
    clearFocus: vi.fn(),
    refreshData: vi.fn(),
  };
}

describe("isFormField", () => {
  it("is true for inputs, textareas, selects and contenteditable hosts", () => {
    expect(isFormField(document.createElement("input"))).toBe(true);
    expect(isFormField(document.createElement("textarea"))).toBe(true);
    expect(isFormField(document.createElement("select"))).toBe(true);
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    expect(isFormField(editable)).toBe(true);
  });

  it("is false for plain elements and null", () => {
    expect(isFormField(document.createElement("div"))).toBe(false);
    expect(isFormField(null)).toBe(false);
  });
});

describe("resolveShortcut", () => {
  it("maps 1-5 to the five views", () => {
    expect(resolveShortcut(keyEvent("1"))).toBe("dashboard");
    expect(resolveShortcut(keyEvent("2"))).toBe("new-task");
    expect(resolveShortcut(keyEvent("3"))).toBe("run-details");
    expect(resolveShortcut(keyEvent("4"))).toBe("agents");
    expect(resolveShortcut(keyEvent("5"))).toBe("settings");
  });

  it("maps j/k/Enter to run navigation", () => {
    expect(resolveShortcut(keyEvent("j"))).toBe("next-run");
    expect(resolveShortcut(keyEvent("k"))).toBe("prev-run");
    expect(resolveShortcut(keyEvent("Enter"))).toBe("open-run");
  });

  it("maps action keys r, Ctrl+k and p", () => {
    expect(resolveShortcut(keyEvent("r"))).toBe("retry-run");
    expect(resolveShortcut(keyEvent("k", { ctrl: true }))).toBe("kill-run");
    expect(resolveShortcut(keyEvent("p"))).toBe("show-prompt");
  });

  it("maps global keys /, Escape, Ctrl+r and Ctrl+f", () => {
    expect(resolveShortcut(keyEvent("/"))).toBe("focus-filter");
    expect(resolveShortcut(keyEvent("Escape"))).toBe("clear-focus");
    expect(resolveShortcut(keyEvent("r", { ctrl: true }))).toBe("refresh");
    expect(resolveShortcut(keyEvent("f", { ctrl: true }))).toBe("focus-filter");
  });

  it("rejects plain keys with ctrl/alt/meta and unknown keys", () => {
    expect(resolveShortcut(keyEvent("j", { ctrl: true }))).toBeNull();
    expect(resolveShortcut(keyEvent("r", { alt: true }))).toBeNull();
    expect(resolveShortcut(keyEvent("p", { meta: true }))).toBeNull();
    expect(resolveShortcut(keyEvent("x"))).toBeNull();
  });
});

describe("handleKeydown", () => {
  it("dispatches the matching handler and prevents the default", () => {
    const handlers = noopHandlers();
    const event = keyEvent("j");
    expect(handleKeydown(event, handlers)).toBe(true);
    expect(handlers.selectNextRun).toHaveBeenCalledOnce();
    expect(event.defaultPrevented).toBe(true);
  });

  it("routes 1-5, Enter, actions and globals to their handlers", () => {
    for (const [key, mods, method, arg] of [
      ["2", {}, "navigateTo", "new-task"],
      ["4", {}, "navigateTo", "agents"],
      ["5", {}, "navigateTo", "settings"],
      ["Enter", {}, "openSelectedRun", undefined],
      ["r", {}, "retrySelectedRun", undefined],
      ["k", { ctrl: true }, "killSelectedRun", undefined],
      ["p", {}, "showPrompt", undefined],
      ["/", {}, "focusFilter", undefined],
      ["Escape", {}, "clearFocus", undefined],
      ["r", { ctrl: true }, "refreshData", undefined],
    ] as const) {
      const handlers = noopHandlers();
      expect(handleKeydown(keyEvent(key, mods), handlers)).toBe(true);
      if (method === "navigateTo") {
        expect(handlers.navigateTo).toHaveBeenCalledWith(arg);
      } else {
        expect(handlers[method]).toHaveBeenCalledOnce();
      }
    }
  });

  it("ignores keys typed in form fields", () => {
    const handlers = noopHandlers();
    const input = document.createElement("input");
    const event = new KeyboardEvent("keydown", { key: "j" });
    Object.defineProperty(event, "target", { value: input });
    expect(handleKeydown(event, handlers)).toBe(false);
    expect(handlers.selectNextRun).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it("lets Ctrl+F reach the filter while typing, but not the plain /", () => {
    const handlers = noopHandlers();
    const input = document.createElement("input");

    const ctrl = new KeyboardEvent("keydown", { key: "f", ctrlKey: true, cancelable: true });
    Object.defineProperty(ctrl, "target", { value: input });
    expect(handleKeydown(ctrl, handlers)).toBe(true);
    expect(handlers.focusFilter).toHaveBeenCalledOnce();
    expect(ctrl.defaultPrevented).toBe(true);

    const slash = new KeyboardEvent("keydown", { key: "/", cancelable: true });
    Object.defineProperty(slash, "target", { value: input });
    expect(handleKeydown(slash, handlers)).toBe(false);
    expect(handlers.focusFilter).toHaveBeenCalledOnce();
    expect(slash.defaultPrevented).toBe(false);
  });

  it("returns false for unmapped keys without preventing default", () => {
    const handlers = noopHandlers();
    const event = keyEvent("x");
    expect(handleKeydown(event, handlers)).toBe(false);
    for (const fn of Object.values(handlers)) expect(fn).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });
});

describe("neighborRunId", () => {
  const runs: Pick<ApiRun, "runId">[] = [{ runId: "a" }, { runId: "b" }, { runId: "c" }];

  it("moves down (+1) and up (-1) through the list", () => {
    expect(neighborRunId(runs, "a", 1)).toBe("b");
    expect(neighborRunId(runs, "b", 1)).toBe("c");
    expect(neighborRunId(runs, "b", -1)).toBe("a");
  });

  it("clamps at the ends", () => {
    expect(neighborRunId(runs, "c", 1)).toBe("c");
    expect(neighborRunId(runs, "a", -1)).toBe("a");
  });

  it("starts from the first run when nothing is selected", () => {
    expect(neighborRunId(runs, null, 1)).toBe("a");
    expect(neighborRunId(runs, null, -1)).toBe("a");
  });

  it("returns null for an empty list", () => {
    expect(neighborRunId([], null, 1)).toBeNull();
  });

  it("falls back to the first run when the selection is missing", () => {
    expect(neighborRunId(runs, "gone", 1)).toBe("a");
  });
});

describe("keyboardShortcuts", () => {
  it("documents every shortcut the resolver maps", () => {
    const ids = new Set(keyboardShortcuts.map((s) => s.id));
    for (const id of [
      "dashboard",
      "new-task",
      "run-details",
      "agents",
      "settings",
      "next-run",
      "prev-run",
      "open-run",
      "retry-run",
      "kill-run",
      "show-prompt",
      "focus-filter",
      "clear-focus",
      "refresh",
    ]) {
      expect(ids).toContain(id);
    }
  });
});
