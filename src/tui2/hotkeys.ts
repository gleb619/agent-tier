import type { KeyEvent } from "@opentui/core";

/**
 * Pure hotkey mapping for the sidebar filter entry.
 *
 * Two bindings reach the filter from every focus zone:
 *  - `/`    — the conventional "focus the list filter" key; deliberately NOT
 *             bound while a text field owns the keyboard, so `/` stays a
 *             typable character inside the filter/prompt fields.
 *  - Ctrl+F — text-field agnostic (like Ctrl+Q), so it also works while the
 *             prompt or the filter itself is focused.
 */

/** The subset of a KeyEvent these decisions depend on. */
export type FilterHotkeyInput = Pick<KeyEvent, "name" | "ctrl">;

/** Keys that move the sidebar cursor onto the filter row and focus it. */
export function isFilterHotkey(key: FilterHotkeyInput): boolean {
  if (key.ctrl) return key.name === "f";
  return key.name === "/";
}
