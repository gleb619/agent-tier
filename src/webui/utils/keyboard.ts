import type { ViewType } from "$types/index";

/** Every keyboard shortcut, identified for dispatch and help listings. */
export type ShortcutId =
  | "dashboard"
  | "new-task"
  | "run-details"
  | "settings"
  | "next-run"
  | "prev-run"
  | "open-run"
  | "retry-run"
  | "kill-run"
  | "show-prompt"
  | "focus-filter"
  | "clear-focus"
  | "refresh";

/** Handlers the dispatcher invokes; MainLayout wires them to stores and actions. */
export interface KeyboardHandlers {
  navigateTo(view: ViewType): void;
  selectNextRun(): void;
  selectPreviousRun(): void;
  openSelectedRun(): void;
  retrySelectedRun(): void;
  killSelectedRun(): void;
  showPrompt(): void;
  focusFilter(): void;
  clearFocus(): void;
  refreshData(): void;
}

/** Static shortcut sheet (TUI-mirrored keys, per docs/ideas §12). */
export const keyboardShortcuts: { id: ShortcutId; keys: string; description: string }[] = [
  { id: "dashboard", keys: "1", description: "Go to Dashboard" },
  { id: "new-task", keys: "2", description: "Go to New Task" },
  { id: "run-details", keys: "3", description: "Go to Run Details" },
  { id: "settings", keys: "4", description: "Go to Settings" },
  { id: "next-run", keys: "j", description: "Select next run" },
  { id: "prev-run", keys: "k", description: "Select previous run" },
  { id: "open-run", keys: "Enter", description: "Open selected run" },
  { id: "retry-run", keys: "r", description: "Retry selected run" },
  { id: "kill-run", keys: "Ctrl+k", description: "Kill selected run (with confirm)" },
  { id: "show-prompt", keys: "p", description: "Show prompt of selected run" },
  { id: "focus-filter", keys: "/", description: "Focus the run filter input" },
  { id: "clear-focus", keys: "Escape", description: "Clear selection / focus" },
  { id: "refresh", keys: "Ctrl+r", description: "Refresh data" },
];

const VIEW_KEYS: Record<string, ViewType> = {
  "1": "dashboard",
  "2": "new-task",
  "3": "run-details",
  "4": "settings",
};

const PLAIN_KEYS: Record<string, ShortcutId> = {
  j: "next-run",
  k: "prev-run",
  Enter: "open-run",
  r: "retry-run",
  p: "show-prompt",
  "/": "focus-filter",
  Escape: "clear-focus",
};

const CTRL_KEYS: Record<string, ShortcutId> = {
  k: "kill-run",
  r: "refresh",
};

/** True while the user is typing — shortcuts must not fire. */
export function isFormField(target: EventTarget | null): boolean {
  if (target === null || !(target instanceof HTMLElement)) return false;
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    target.isContentEditable === true ||
    target.getAttribute("contenteditable") === "true"
  );
}

/** Pure key → shortcut mapping; null when the key combination is not a shortcut. */
export function resolveShortcut(
  event: Pick<KeyboardEvent, "key" | "ctrlKey" | "altKey" | "metaKey">,
): ShortcutId | null {
  if (event.altKey || event.metaKey) return null;
  if (event.ctrlKey) return CTRL_KEYS[event.key] ?? null;
  return PLAIN_KEYS[event.key] ?? VIEW_KEYS[event.key] ?? null;
}

/**
 * Resolve and dispatch one keydown. Returns true when a shortcut fired
 * (the event is consumed: default prevented); false to let it bubble.
 */
export function handleKeydown(event: KeyboardEvent, handlers: KeyboardHandlers): boolean {
  if (isFormField(event.target)) return false;
  const shortcut = resolveShortcut(event);
  if (!shortcut) return false;
  switch (shortcut) {
    case "dashboard":
    case "new-task":
    case "run-details":
    case "settings":
      handlers.navigateTo(shortcut);
      break;
    case "next-run":
      handlers.selectNextRun();
      break;
    case "prev-run":
      handlers.selectPreviousRun();
      break;
    case "open-run":
      handlers.openSelectedRun();
      break;
    case "retry-run":
      handlers.retrySelectedRun();
      break;
    case "kill-run":
      handlers.killSelectedRun();
      break;
    case "show-prompt":
      handlers.showPrompt();
      break;
    case "focus-filter":
      handlers.focusFilter();
      break;
    case "clear-focus":
      handlers.clearFocus();
      break;
    case "refresh":
      handlers.refreshData();
      break;
  }
  event.preventDefault();
  return true;
}

/**
 * Run id `delta` steps from `currentId` in `runs` (display order), clamped at
 * the ends; with no (or a missing) selection it returns the first run.
 */
export function neighborRunId(runs: { runId: string }[], currentId: string | null, delta: 1 | -1): string | null {
  if (runs.length === 0) return null;
  const index = runs.findIndex((run) => run.runId === currentId);
  if (index === -1) return runs[0].runId;
  return runs[Math.min(Math.max(index + delta, 0), runs.length - 1)].runId;
}
