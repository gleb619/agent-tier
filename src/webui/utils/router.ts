import type { ComponentType } from "svelte";
import { derived, get } from "svelte/store";
import { selectedRunId, selectRun } from "$stores/runs";
import { currentView } from "$stores/ui";
import type { RouteView, ViewType } from "$types/index";

export interface Route {
  view: RouteView;
  runId?: string;
}

const TITLES: Record<RouteView, string> = {
  dashboard: "Dashboard — at",
  "new-task": "New Task — at",
  "run-details": "Run Details — at",
  agents: "Agents — at",
  settings: "Settings — at",
  "not-found": "Not Found — at",
};

export function parsePath(input: string): Route {
  const trimmed = input.replace(/\/$/, "") || "/";
  if (trimmed === "/" || trimmed === "/index.html") {
    return { view: "dashboard" };
  }
  if (trimmed === "/new") {
    return { view: "new-task" };
  }
  if (trimmed === "/agents") {
    return { view: "agents" };
  }
  if (trimmed === "/settings") {
    return { view: "settings" };
  }
  if (trimmed === "/runs") {
    return { view: "dashboard" };
  }
  const runMatch = /^\/runs\/(.+)$/.exec(trimmed);
  if (runMatch) {
    return { view: "run-details", runId: decodeURIComponent(runMatch[1]!) };
  }
  return { view: "not-found" };
}

export function formatPath(route: Route): string | null {
  switch (route.view) {
    case "dashboard":
      return "/";
    case "new-task":
      return "/new";
    case "agents":
      return "/agents";
    case "settings":
      return "/settings";
    case "run-details": {
      if (!route.runId) return "/";
      return `/runs/${encodeURIComponent(route.runId)}`;
    }
    default:
      return null;
  }
}

export function titleForView(view: RouteView): string {
  return TITLES[view] ?? "at";
}

export function headingForView(view: RouteView): string {
  return titleForView(view).split(" — ")[0]!;
}

export const viewModules: Record<ViewType, () => Promise<{ default: ComponentType }>> = {
  dashboard: () => import("$components/dashboard/DashboardView.svelte"),
  "new-task": () => import("$components/newtask/NewTaskView.svelte"),
  "run-details": () => import("$components/run/RunDetailsView.svelte"),
  agents: () => import("$components/agents/AgentsView.svelte"),
  settings: () => import("$components/settings/SettingsView.svelte"),
};

export function navigateTo(view: ViewType, runId?: string): void {
  if (view === "run-details" && runId === undefined) {
    runId = get(selectedRunId) ?? undefined;
  }
  if (runId) {
    selectRun(runId);
  }
  currentView.set(view);
}

export function startRouter(): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }

  const initial = parsePath(window.location.pathname);
  if (initial.runId) {
    selectRun(initial.runId);
  }
  currentView.set(initial.view);

  const route$ = derived([currentView, selectedRunId], ([view, runId]) => ({
    view,
    runId: view === "run-details" ? (runId ?? undefined) : undefined,
  }));

  const unsubscribe = route$.subscribe((route) => {
    syncRoute(route);
  });

  const onPopState = (event: PopStateEvent) => {
    const state = (event.state ?? {}) as { view?: RouteView; runId?: string };
    const route: Route = state.view ? { view: state.view, runId: state.runId } : parsePath(window.location.pathname);
    if (route.runId) {
      selectRun(route.runId);
    }
    currentView.set(route.view);
  };
  window.addEventListener("popstate", onPopState);

  return () => {
    unsubscribe();
    window.removeEventListener("popstate", onPopState);
  };
}

function syncRoute(route: Route): void {
  const path = formatPath(route);
  if (path === null) {
    document.title = titleForView(route.view);
    return;
  }
  if (path !== window.location.pathname) {
    const state = { view: route.view, runId: route.runId };
    history.pushState(state, "", path);
  }
  document.title = titleForView(route.view);
}
