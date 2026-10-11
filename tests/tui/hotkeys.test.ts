import { describe, expect, it } from "vitest";
import { isFilterHotkey } from "../../src/tui/hotkeys";

describe("filter hotkey mapping", () => {
  it("binds / for the plain-character path", () => {
    expect(isFilterHotkey({ name: "/", ctrl: false })).toBe(true);
  });

  it("binds Ctrl+F for the ctrl path", () => {
    // The key parser normalises Ctrl+F to { name: 'f', ctrl: true }.
    expect(isFilterHotkey({ name: "f", ctrl: true })).toBe(true);
  });

  it("is case-normalised by the key parser, so a bare F is not a match", () => {
    expect(isFilterHotkey({ name: "F", ctrl: false })).toBe(false);
    expect(isFilterHotkey({ name: "F", ctrl: true })).toBe(false);
  });

  it("does not bind / under ctrl or ? under shift", () => {
    expect(isFilterHotkey({ name: "/", ctrl: true })).toBe(false);
    expect(isFilterHotkey({ name: "?", ctrl: false })).toBe(false);
  });

  it("leaves every other key alone", () => {
    expect(isFilterHotkey({ name: "q", ctrl: false })).toBe(false);
    expect(isFilterHotkey({ name: "q", ctrl: true })).toBe(false);
    expect(isFilterHotkey({ name: "j", ctrl: false })).toBe(false);
    expect(isFilterHotkey({ name: "1", ctrl: false })).toBe(false);
    expect(isFilterHotkey({ name: "up", ctrl: false })).toBe(false);
    expect(isFilterHotkey({ name: "return", ctrl: true })).toBe(false);
    expect(isFilterHotkey({ name: "tab", ctrl: false })).toBe(false);
  });
});
