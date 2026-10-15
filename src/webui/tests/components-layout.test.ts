import { fireEvent, render, screen } from "@testing-library/svelte";
import { tick } from "svelte";
import { get } from "svelte/store";
import { beforeEach, describe, expect, it } from "vitest";
import { NAV_WIDTH_PX } from "../../ui-spec";
import MainLayout from "../components/layout/MainLayout.svelte";
import AgentBadge from "../components/run/AgentBadge.svelte";
import StatusBadge from "../components/run/StatusBadge.svelte";
import TierBadge from "../components/run/TierBadge.svelte";
import { selectedRunId, selectRun, setRuns } from "../stores/runs";
import { connectionError, sseConnected } from "../stores/sse";
import { currentView, setCurrentView, sidebarOpen } from "../stores/ui";
import type { ApiRun } from "../types/api";

describe("MainLayout shell", () => {
  beforeEach(() => {
    window.history.pushState({}, "", "/");
    setRuns([]);
    selectRun(null);
    setCurrentView("dashboard");
    sidebarOpen.set(true);
  });

  it("renders the dashboard view and switches via navigation", async () => {
    render(MainLayout);
    expect(screen.getByRole("heading", { name: "Dashboard" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Settings" })).not.toBeInTheDocument();

    await fireEvent.click(screen.getByRole("button", { name: /New Task/ }));
    expect(get(currentView)).toBe("new-task");
    expect(screen.getByRole("heading", { name: "New Task" })).toBeInTheDocument();
  });

  it("shows shortcut badges 1-5 in navigation", () => {
    render(MainLayout);
    for (const key of ["1", "2", "3", "4", "5"]) {
      expect(screen.getByText(key)).toBeInTheDocument();
    }
  });

  it("switches views with number keys, ignoring form fields", async () => {
    render(MainLayout);
    await fireEvent.keyDown(window, { key: "3" });
    expect(get(currentView)).toBe("run-details");
    expect(screen.getByRole("heading", { name: "Run Details" })).toBeInTheDocument();

    await fireEvent.keyDown(window, { key: "4" });
    expect(get(currentView)).toBe("agents");
    expect(screen.getByRole("heading", { name: "Agents" })).toBeInTheDocument();

    await fireEvent.keyDown(window, { key: "5" });
    expect(get(currentView)).toBe("settings");
    expect(screen.getByRole("heading", { name: "Settings" })).toBeInTheDocument();

    const input = document.createElement("input");
    document.body.appendChild(input);
    await fireEvent.keyDown(input, { key: "4" });
    expect(get(currentView)).toBe("settings"); // unchanged: typing in a field
    input.remove();
  });

  it("collapses the sidebar from the header toggle", async () => {
    render(MainLayout);
    const toggle = screen.getByRole("button", { name: /toggle sidebar/i });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    await fireEvent.click(toggle);
    expect(get(sidebarOpen)).toBe(false);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
  });

  it("reflects SSE connection state in the status bar", async () => {
    render(MainLayout);
    expect(screen.getByText("Disconnected")).toBeInTheDocument();
    sseConnected.set(true);
    await tick();
    expect(screen.getByText("Connected")).toBeInTheDocument();
    sseConnected.set(false);
    connectionError.set("hub down");
    await tick();
    expect(screen.getByText("hub down")).toBeInTheDocument();
    connectionError.set(null);
  });

  it("renders the filter above the navigation inside the sidebar", () => {
    render(MainLayout);
    const sidebar = screen.getByRole("complementary", { name: /sidebar/i });
    const filter = screen.getByLabelText("Filter runs");
    const nav = screen.getByRole("navigation", { name: /main/i });
    // filter precedes nav in document order
    const FILTER_PRECEDES_NAV = Node.DOCUMENT_POSITION_FOLLOWING | Node.DOCUMENT_POSITION_CONTAINED_BY;
    expect(sidebar.compareDocumentPosition(filter) & Node.DOCUMENT_POSITION_CONTAINED_BY).toBeTruthy();
    expect(sidebar.compareDocumentPosition(nav) & Node.DOCUMENT_POSITION_CONTAINED_BY).toBeTruthy();
    expect(filter.compareDocumentPosition(nav) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    FILTER_PRECEDES_NAV; // keep reference for clarity
  });

  it("uses the spec sidebar width (NAV_WIDTH_PX)", () => {
    render(MainLayout);
    const sidebar = screen.getByRole("complementary", { name: /sidebar/i });
    expect(sidebar.className).toContain(`w-[${NAV_WIDTH_PX}px]`);
  });

  it("hides nav items whose labels don't match the search query", async () => {
    render(MainLayout);
    expect(screen.getByRole("button", { name: /Dashboard/ })).toBeInTheDocument();
    await fireEvent.input(screen.getByLabelText("Filter runs"), { target: { value: "xyz-no-match" } });
    expect(screen.queryByRole("button", { name: /Dashboard/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /New Task/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Run Details/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Agents/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Settings/ })).not.toBeInTheDocument();
    // number keys still navigate even though every nav row is hidden
    await fireEvent.keyDown(window, { key: "1" });
    expect(get(currentView)).toBe("dashboard");
  });

  it("keeps the selected run in sync with the run-details URL", async () => {
    setRuns([makeRun({ runId: "abc" })]);
    render(MainLayout);
    selectRun("abc");
    setCurrentView("run-details");
    expect(get(selectedRunId)).toBe("abc");
    expect(window.location.pathname).toBe("/runs/abc");
  });
});

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

describe("run badges", () => {
  it("StatusBadge maps run statuses to labels", () => {
    render(StatusBadge, { status: "running" });
    expect(screen.getByText("running")).toBeInTheDocument();
  });

  it("AgentBadge shows the agent name", () => {
    render(AgentBadge, { name: "mm-code", enabled: true });
    expect(screen.getByText("mm-code")).toBeInTheDocument();
  });

  it("TierBadge renders tier labels", () => {
    render(TierBadge, { tier: 2 });
    expect(screen.getByText("T2")).toBeInTheDocument();
  });
});
