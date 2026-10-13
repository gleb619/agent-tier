import { get } from "svelte/store";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { selectedRunId, selectRun, setRuns } from "../stores/runs";
import { currentView, setCurrentView, sidebarOpen } from "../stores/ui";
import type { ApiRun } from "../types/api";
import { formatPath, headingForView, navigateTo, parsePath, startRouter, titleForView } from "../utils/router";

function makeRun(partial: Partial<ApiRun> = {}): ApiRun {
  return {
    runId: "r1",
    agent: "mm-code",
    tier: 2,
    pid: 1,
    prompt: "p",
    logFile: "/tmp/r1.log",
    startedAt: "2026-10-11T10:00:00.000Z",
    finishedAt: null,
    exitCode: null,
    status: "running",
    name: "UNNAMED",
    ...partial,
  };
}

describe("parsePath", () => {
  it.each([
    ["/", { view: "dashboard" }],
    ["/index.html", { view: "dashboard" }],
    ["/new", { view: "new-task" }],
    ["/settings", { view: "settings" }],
    ["/runs/abc", { view: "run-details", runId: "abc" }],
    ["/runs/foo%20bar", { view: "run-details", runId: "foo bar" }],
    ["/unknown", { view: "not-found" }],
    ["/runs/", { view: "dashboard" }],
  ] as const)("parses %s", (input, expected) => {
    expect(parsePath(input)).toEqual(expected);
  });
});

describe("formatPath", () => {
  it("round-trips known routes", () => {
    expect(formatPath({ view: "dashboard" })).toBe("/");
    expect(formatPath({ view: "new-task" })).toBe("/new");
    expect(formatPath({ view: "settings" })).toBe("/settings");
    expect(formatPath({ view: "run-details", runId: "abc" })).toBe("/runs/abc");
    expect(formatPath({ view: "run-details", runId: "foo bar" })).toBe("/runs/foo%20bar");
  });

  it("falls back to / for run-details without a run id", () => {
    expect(formatPath({ view: "run-details" })).toBe("/");
  });

  it("preserves unknown URLs for the 404 view", () => {
    expect(formatPath({ view: "not-found" })).toBeNull();
  });
});

describe("titles", () => {
  it.each([
    ["dashboard", "Dashboard — at"],
    ["new-task", "New Task — at"],
    ["run-details", "Run Details — at"],
    ["settings", "Settings — at"],
    ["not-found", "Not Found — at"],
  ] as const)("title for %s", (view, title) => {
    expect(titleForView(view)).toBe(title);
    expect(headingForView(view)).toBe(title.split(" — ")[0]);
  });
});

describe("navigation", () => {
  beforeEach(() => {
    window.history.pushState({}, "", "/");
    setRuns([]);
    selectRun(null);
    currentView.set("dashboard");
    sidebarOpen.set(true);
  });

  it("navigateTo updates the current view", () => {
    navigateTo("settings");
    expect(get(currentView)).toBe("settings");
  });

  it("navigateTo(run-details) uses the currently selected run", () => {
    setRuns([makeRun({ runId: "abc" })]);
    selectRun("abc");
    navigateTo("run-details");
    expect(get(currentView)).toBe("run-details");
  });

  it("navigateTo(run-details, id) selects that run", () => {
    navigateTo("run-details", "xyz");
    expect(get(currentView)).toBe("run-details");
    expect(get(selectedRunId)).toBe("xyz");
  });

  it("startRouter reads the current URL", () => {
    window.history.pushState({}, "", "/new");
    const stop = startRouter();
    expect(get(currentView)).toBe("new-task");
    stop();
  });

  it("startRouter parses /runs/:id and selects the run", () => {
    setRuns([makeRun({ runId: "abc" })]);
    window.history.pushState({}, "", "/runs/abc");
    const stop = startRouter();
    expect(get(currentView)).toBe("run-details");
    expect(get(selectedRunId)).toBe("abc");
    stop();
  });

  it("startRouter falls back to dashboard for unknown deep links", () => {
    window.history.pushState({}, "", "/nope");
    const stop = startRouter();
    expect(get(currentView)).toBe("not-found");
    stop();
  });

  it("changing currentView pushes a history entry", () => {
    const stop = startRouter();
    setCurrentView("settings");
    expect(window.location.pathname).toBe("/settings");
    stop();
  });

  it("selecting a run while in run-details updates the URL", () => {
    const stop = startRouter();
    setRuns([makeRun({ runId: "a" }), makeRun({ runId: "b" })]);
    selectRun("a");
    setCurrentView("run-details");
    expect(window.location.pathname).toBe("/runs/a");

    selectRun("b");
    expect(window.location.pathname).toBe("/runs/b");
    stop();
  });
});
