import { fireEvent, render, screen } from "@testing-library/svelte";
import { tick } from "svelte";
import { get } from "svelte/store";
import { beforeEach, describe, expect, it } from "vitest";
import AgentBadge from "../components/run/AgentBadge.svelte";
import MainLayout from "../components/layout/MainLayout.svelte";
import StatusBadge from "../components/run/StatusBadge.svelte";
import TierBadge from "../components/run/TierBadge.svelte";
import { connectionError, sseConnected } from "../stores/sse";
import { currentView, setCurrentView, sidebarOpen } from "../stores/ui";

describe("MainLayout shell", () => {
  beforeEach(() => {
    setCurrentView("dashboard");
    sidebarOpen.set(true);
  });

  it("renders the four placeholder views and switches via navigation", async () => {
    render(MainLayout);
    expect(screen.getByRole("heading", { name: "Dashboard" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Settings" })).not.toBeInTheDocument();

    await fireEvent.click(screen.getByRole("button", { name: /New Task/ }));
    expect(get(currentView)).toBe("new-task");
    expect(screen.getByRole("heading", { name: "New Task" })).toBeInTheDocument();
  });

  it("shows shortcut badges 1-4 in navigation", () => {
    render(MainLayout);
    for (const key of ["1", "2", "3", "4"]) {
      expect(screen.getByText(key)).toBeInTheDocument();
    }
  });

  it("switches views with number keys, ignoring form fields", async () => {
    render(MainLayout);
    await fireEvent.keyDown(window, { key: "3" });
    expect(get(currentView)).toBe("run-details");
    expect(screen.getByRole("heading", { name: "Run Details" })).toBeInTheDocument();

    const input = document.createElement("input");
    document.body.appendChild(input);
    await fireEvent.keyDown(input, { key: "4" });
    expect(get(currentView)).toBe("run-details"); // unchanged: typing in a field
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
});

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
