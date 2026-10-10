import { createSignal } from 'solid-js';

export type ActiveView = 'dashboard' | 'new-task' | 'settings' | 'run-details';

/**
 * Which zone owns keyboard input. Text-entry zones ('sidebar-filter',
 * 'prompt') swallow plain character keys, so global hotkeys (1-4, j/k, q)
 * stand down while the user is typing.
 */
export type FocusZone = 'sidebar-filter' | 'sidebar-list' | 'prompt' | 'log' | 'settings';

const [activeView, setActiveView] = createSignal<ActiveView>('dashboard');
const [sidebarFilter, setSidebarFilter] = createSignal<string>('');
const [focusZone, setFocusZone] = createSignal<FocusZone>('sidebar-list');
const [showPromptOverlay, setShowPromptOverlay] = createSignal<boolean>(false);
const [settingsRow, setSettingsRow] = createSignal<number>(0);

/**
 * Index into the flat sidebar row model (filter → menu → separator → runs).
 * `-1` means "no selection" — used when the selectable subset is empty.
 * The Sidebar component owns clamping this against the current row list.
 */
const [sidebarIndex, setSidebarIndex] = createSignal<number>(0);

export {
  activeView,
  setActiveView,
  sidebarFilter,
  setSidebarFilter,
  focusZone,
  setFocusZone,
  showPromptOverlay,
  setShowPromptOverlay,
  settingsRow,
  setSettingsRow,
  sidebarIndex,
  setSidebarIndex,
};

/** True while a text field owns the keyboard (plain-char hotkeys stay off). */
export function isTextEntryFocused(): boolean {
  const zone = focusZone();
  return zone === 'sidebar-filter' || zone === 'prompt';
}

/** The main-column zone a view exposes, or null when it has nothing to focus. */
const MAIN_ZONE: Record<ActiveView, FocusZone | null> = {
  dashboard: null,
  'new-task': 'prompt',
  'run-details': 'log',
  settings: 'settings',
};

/** The main-column zone a view exposes, or the run list when it has none. */
export function mainZoneForView(view: ActiveView): FocusZone {
  return MAIN_ZONE[view] ?? 'sidebar-list';
}

/** Zones Tab cycles through for a view: sidebar filter, run list, then main pane. */
export function zonesForView(view: ActiveView): FocusZone[] {
  const main = MAIN_ZONE[view];
  return main ? ['sidebar-filter', 'sidebar-list', main] : ['sidebar-filter', 'sidebar-list'];
}

/**
 * Switch views, dropping state that only made sense in the old one (prompt
 * overlay) and moving focus somewhere valid inside the new one.
 */
export function goToView(view: ActiveView): void {
  setActiveView(view);
  setShowPromptOverlay(false);
  if (view === 'new-task') {
    setFocusZone('prompt');
    return;
  }
  if (!zonesForView(view).includes(focusZone())) {
    setFocusZone(mainZoneForView(view));
  }
}

/**
 * Tab / Shift+Tab: walk the active view's zones. A focus zone that no longer
 * belongs to the view (after a view switch) restarts from the first zone.
 */
export function cycleZone(direction: 1 | -1): void {
  const zones = zonesForView(activeView());
  const from = Math.max(0, zones.indexOf(focusZone()));
  setFocusZone(zones[(from + direction + zones.length) % zones.length]);
}
