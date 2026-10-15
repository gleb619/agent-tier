import { fireEvent, render, screen, within } from "@testing-library/svelte";
import { get } from "svelte/store";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AGENT_HEALTH_CONFIG, NAV_ITEMS } from "../../ui-spec";
import AgentsView from "../components/agents/AgentsView.svelte";
import Navigation from "../components/sidebar/Navigation.svelte";
import { agentRunStats, toggleAgentEnabled } from "../stores/agents";
import { agents, dashboardError } from "../stores/dashboard";
import { searchQuery } from "../stores/filters";
import { setRuns } from "../stores/runs";
import { toasts } from "../stores/toast";
import { currentView, setCurrentView, sidebarOpen } from "../stores/ui";
import type { ApiAgent, ApiRun } from "../types/api";
import {
  agentHealth,
  blockedUntilLabel,
  countRunsByAgent,
  filterAgents,
  formatAgentRunStats,
  groupAgentsByTier,
  isAgentEnabled,
  isUserEnabled,
} from "../utils/agents";
import { handleKeydown, type KeyboardHandlers, resolveShortcut } from "../utils/keyboard";

function makeAgent(name: string, partial: Partial<ApiAgent> = {}): ApiAgent {
  return {
    name,
    tier: 2,
    promptMode: "prompt",
    deactivated: false,
    failures: 0,
    lastFailure: null,
    disabledTo: null,
    ...partial,
  };
}

function makeRun(id: string, agent: string, status: ApiRun["status"]): ApiRun {
  return {
    runId: id,
    agent,
    tier: 2,
    pid: 1,
    prompt: `prompt ${id}`,
    logFile: `/tmp/${id}.log`,
    startedAt: new Date().toISOString(),
    finishedAt: status === "running" ? null : new Date().toISOString(),
    exitCode: status === "done" ? 0 : null,
    status,
    name: `Run ${id}`,
  };
}

/** stubFetch answers PUT /api/agents/:name/{enable,disable} with `status`. */
function stubAgentToggle(status = 202): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async () => new Response(null, { status }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function toggleCalls(fetchMock: ReturnType<typeof vi.fn>): { url: string; method: string }[] {
  return fetchMock.mock.calls.map((call) => ({
    url: String(call[0]),
    method: String((call[1] as RequestInit | undefined)?.method ?? "GET"),
  }));
}

/** Every `KeyboardHandlers` member as a spy; `navigateTo` drives the real store. */
function handlers(): KeyboardHandlers {
  return {
    navigateTo: setCurrentView,
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

function keyEvent(key: string): KeyboardEvent {
  return new KeyboardEvent("keydown", { key, cancelable: true });
}

const AGENTS: ApiAgent[] = [
  makeAgent("glm-code", { tier: 1 }),
  makeAgent("codex", { tier: 1 }),
  makeAgent("kimi", { tier: 1, failures: 3 }),
  makeAgent("mm-code"),
  makeAgent("qwen"),
  makeAgent("mock", { tier: 4, deactivated: true }),
];

beforeEach(() => {
  agents.set(AGENTS.map((agent) => ({ ...agent })));
  dashboardError.set(null);
  toasts.set([]);
  setRuns([]);
  searchQuery.set("");
  currentView.set("dashboard");
  sidebarOpen.set(true);
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Navigation (spec order)", () => {
  it("renders the five nav items in NAV_ITEMS order with their shortcut badges", () => {
    render(Navigation);
    const nav = screen.getByRole("navigation", { name: /main/i });
    const buttons = within(nav).getAllByRole("button");
    expect(buttons.map((button) => button.textContent?.replace(/\s+/g, " ").trim())).toEqual([
      "Dashboard 1",
      "New Task 2",
      "Run Details 3",
      "Agents 4",
      "Settings 5",
    ]);
    for (const item of NAV_ITEMS) {
      expect(within(nav).getByRole("button", { name: item.label })).toBeInTheDocument();
    }
  });

  it("navigates to the agents view on click", async () => {
    render(Navigation);
    await fireEvent.click(screen.getByRole("button", { name: "Agents" }));
    expect(get(currentView)).toBe("agents");
  });
});

describe("AgentsView", () => {
  it("groups agents per tier with the spec label and role", () => {
    render(AgentsView);
    expect(within(screen.getByTestId("agents-tier-1")).getByText("Tier 1 — architect / review")).toBeInTheDocument();
    expect(within(screen.getByTestId("agents-tier-2")).getByText("Tier 2 — dev / QA")).toBeInTheDocument();
    expect(within(screen.getByTestId("agents-tier-4")).getByText("Tier 4 — dry-run / test agents")).toBeInTheDocument();
    // No tier-3 agent in the fixture → that group is dropped entirely.
    expect(screen.queryByTestId("agents-tier-3")).not.toBeInTheDocument();

    const tier1 = screen.getByTestId("agents-tier-1");
    for (const name of ["glm-code", "codex", "kimi"]) {
      expect(within(tier1).getByTestId(`agent-${name}`)).toBeInTheDocument();
    }
    expect(within(tier1).queryByTestId("agent-mm-code")).not.toBeInTheDocument();
    expect(within(screen.getByTestId("agents-tier-2")).getByTestId("agent-mm-code")).toBeInTheDocument();
  });

  it("shows the health glyph and badge per agent", () => {
    render(AgentsView);
    const healthy = within(screen.getByTestId("agent-glm-code"));
    expect(healthy.getByText(AGENT_HEALTH_CONFIG.ok.glyph)).toBeInTheDocument();
    expect(healthy.getByText("ok")).toBeInTheDocument();

    const failing = within(screen.getByTestId("agent-kimi"));
    expect(failing.getByText(AGENT_HEALTH_CONFIG.failing.glyph)).toBeInTheDocument();
    expect(failing.getByText("failing")).toBeInTheDocument();

    const disabled = within(screen.getByTestId("agent-mock"));
    expect(disabled.getByText(AGENT_HEALTH_CONFIG.disabled.glyph)).toBeInTheDocument();
    expect(disabled.getByText("disabled")).toBeInTheDocument();
  });

  it("keeps the Enabled toggle on the user switch and flags a quota window", () => {
    agents.set([...AGENTS, makeAgent("pi", { tier: 3, disabledTo: new Date(Date.now() + 30 * 60_000).toISOString() })]);
    render(AgentsView);
    const card = within(screen.getByTestId("agent-pi"));
    // A quota window blocks the agent but is not what the toggle writes.
    expect(card.getByRole("switch")).toHaveAttribute("aria-checked", "true");
    expect(card.getByText(/^blocked for /)).toBeInTheDocument();
    expect(within(screen.getByTestId("agent-mock")).getByRole("switch")).toHaveAttribute("aria-checked", "false");
  });

  it("shows the run count and success rate from the runs store", () => {
    setRuns([
      makeRun("r1", "mm-code", "done"),
      makeRun("r2", "mm-code", "done"),
      makeRun("r3", "mm-code", "failed"),
      makeRun("r4", "codex", "running"),
    ]);
    render(AgentsView);
    expect(within(screen.getByTestId("agent-mm-code")).getByText("3 runs · 67%")).toBeInTheDocument();
    expect(within(screen.getByTestId("agent-codex")).getByText("1 runs · —")).toBeInTheDocument();
    expect(within(screen.getByTestId("agent-glm-code")).getByText("0 runs · —")).toBeInTheDocument();
  });

  it("filters by name and shows an empty state when nothing matches", async () => {
    render(AgentsView);
    await fireEvent.input(screen.getByLabelText("Filter agents"), { target: { value: "dex" } });
    expect(screen.getByTestId("agent-codex")).toBeInTheDocument();
    expect(screen.queryByTestId("agent-glm-code")).not.toBeInTheDocument();
    expect(screen.queryByTestId("agent-mm-code")).not.toBeInTheDocument();
    expect(screen.queryByTestId("agents-tier-2")).not.toBeInTheDocument();

    await fireEvent.input(screen.getByLabelText("Filter agents"), { target: { value: "zzz" } });
    expect(screen.getByTestId("agents-empty")).toHaveTextContent("No agents match the filter.");
    expect(screen.queryByTestId("agent-codex")).not.toBeInTheDocument();
  });

  it("filters by tier from the tier select", async () => {
    render(AgentsView);
    await fireEvent.change(screen.getByLabelText("Tier"), { target: { value: "1" } });
    expect(screen.getByTestId("agents-tier-1")).toBeInTheDocument();
    expect(screen.queryByTestId("agents-tier-2")).not.toBeInTheDocument();
    expect(screen.queryByTestId("agents-tier-4")).not.toBeInTheDocument();
    expect(within(screen.getByTestId("agents-tier-1")).getAllByTestId(/^agent-/).length).toBe(3);
  });

  it("disables an agent through the API with an optimistic update", async () => {
    const fetchMock = stubAgentToggle();
    render(AgentsView);
    await fireEvent.click(within(screen.getByTestId("agent-mm-code")).getByRole("switch"));

    await vi.waitFor(() =>
      expect(toggleCalls(fetchMock)).toEqual([{ url: "/api/agents/mm-code/disable", method: "PUT" }]),
    );
    expect(get(agents).find((agent) => agent.name === "mm-code")?.deactivated).toBe(true);
    expect(within(screen.getByTestId("agent-mm-code")).getByRole("switch")).toHaveAttribute("aria-checked", "false");
    expect(get(toasts).map((toast) => [toast.kind, toast.message])).toEqual([["success", "mm-code disabled"]]);
  });

  it("re-enables a disabled agent through the API", async () => {
    const fetchMock = stubAgentToggle();
    render(AgentsView);
    await fireEvent.click(within(screen.getByTestId("agent-mock")).getByRole("switch"));

    await vi.waitFor(() => expect(toggleCalls(fetchMock)).toEqual([{ url: "/api/agents/mock/enable", method: "PUT" }]));
    expect(get(agents).find((agent) => agent.name === "mock")?.deactivated).toBe(false);
  });

  it("rolls back and toasts when the API call fails", async () => {
    stubAgentToggle(500);
    render(AgentsView);
    await fireEvent.click(within(screen.getByTestId("agent-mm-code")).getByRole("switch"));

    await vi.waitFor(() => expect(get(toasts).length).toBe(1));
    const toast = get(toasts)[0]!;
    expect(toast.kind).toBe("error");
    expect(toast.message).toContain("Could not disable mm-code");
    expect(get(agents).find((agent) => agent.name === "mm-code")?.deactivated).toBe(false);
    expect(within(screen.getByTestId("agent-mm-code")).getByRole("switch")).toHaveAttribute("aria-checked", "true");
  });
});

describe("keyboard shortcuts", () => {
  it("4 opens Agents and 5 opens Settings", () => {
    const h = handlers();
    expect(handleKeydown(keyEvent("4"), h)).toBe(true);
    expect(get(currentView)).toBe("agents");
    expect(handleKeydown(keyEvent("5"), h)).toBe(true);
    expect(get(currentView)).toBe("settings");
  });

  it("maps the number keys per NAV_ITEMS", () => {
    for (const item of NAV_ITEMS) {
      expect(resolveShortcut(keyEvent(String(item.shortcut)))).toBe(item.id);
    }
  });
});

describe("agents utils", () => {
  it("agentHealth covers ok / disabled / failing", () => {
    expect(agentHealth(makeAgent("a"))).toBe("ok");
    expect(agentHealth(makeAgent("b", { deactivated: true }))).toBe("disabled");
    expect(agentHealth(makeAgent("c", { disabledTo: "2030-01-01T00:00:00Z" }))).toBe("disabled");
    // consecutive failures outrank the disabled flag
    expect(agentHealth(makeAgent("d", { failures: 2, deactivated: true }))).toBe("failing");
  });

  it("isAgentEnabled and isUserEnabled separate rotation from the user switch", () => {
    expect(isAgentEnabled(makeAgent("a"))).toBe(true);
    expect(isAgentEnabled(makeAgent("b", { deactivated: true }))).toBe(false);
    expect(isAgentEnabled(makeAgent("c", { disabledTo: "2030-01-01T00:00:00Z" }))).toBe(false);
    // The quota window is not the user switch: only `deactivated` moves the toggle.
    expect(isUserEnabled(makeAgent("a"))).toBe(true);
    expect(isUserEnabled(makeAgent("b", { deactivated: true }))).toBe(false);
    expect(isUserEnabled(makeAgent("c", { disabledTo: "2030-01-01T00:00:00Z" }))).toBe(true);
  });

  it("blockedUntilLabel counts down a quota window only", () => {
    const now = new Date("2026-10-15T12:00:00Z");
    expect(blockedUntilLabel(null, now)).toBeNull();
    expect(blockedUntilLabel("2026-10-15T11:00:00Z", now)).toBeNull();
    expect(blockedUntilLabel("2026-10-15T12:30:00Z", now)).toBe("blocked for 30m 00s");
    expect(blockedUntilLabel("nonsense", now)).toBeNull();
  });

  it("countRunsByAgent and formatAgentRunStats render the card line", () => {
    expect(countRunsByAgent([])).toEqual(new Map());
    const stats = countRunsByAgent([
      makeRun("r1", "mm-code", "done"),
      makeRun("r2", "mm-code", "failed"),
      makeRun("r3", "codex", "running"),
    ]);
    expect(formatAgentRunStats(stats.get("mm-code"))).toBe("2 runs · 50%");
    expect(formatAgentRunStats(stats.get("codex"))).toBe("1 runs · —");
    expect(formatAgentRunStats(undefined)).toBe("0 runs · —");
  });

  it("filterAgents matches on name and tier", () => {
    expect(filterAgents(AGENTS, "").length).toBe(AGENTS.length);
    expect(filterAgents(AGENTS, "  ").length).toBe(AGENTS.length);
    expect(filterAgents(AGENTS, "CODE").map((a) => a.name)).toEqual(["glm-code", "codex", "mm-code"]);
    expect(filterAgents(AGENTS, "", 1).map((a) => a.name)).toEqual(["glm-code", "codex", "kimi"]);
    expect(filterAgents(AGENTS, "code", 4)).toEqual([]);
  });

  it("groupAgentsByTier keeps spec tier order and drops empty tiers", () => {
    const groups = groupAgentsByTier(AGENTS);
    expect(groups.map((group) => group.tier)).toEqual([1, 2, 4]);
    expect(groups[0]?.agents.map((a) => a.name)).toEqual(["codex", "glm-code", "kimi"]);
  });

  it("agentRunStats recomputes when the runs store changes", () => {
    expect(get(agentRunStats).size).toBe(0);
    setRuns([makeRun("r1", "mm-code", "done")]);
    expect(formatAgentRunStats(get(agentRunStats).get("mm-code"))).toBe("1 runs · 100%");
  });

  it("toggleAgentEnabled flips deactivated and restores it on failure", async () => {
    const ok = stubAgentToggle();
    await toggleAgentEnabled("mm-code", false);
    expect(get(agents).find((a) => a.name === "mm-code")?.deactivated).toBe(true);
    expect(toggleCalls(ok)).toEqual([{ url: "/api/agents/mm-code/disable", method: "PUT" }]);

    vi.unstubAllGlobals();
    stubAgentToggle(500);
    await expect(toggleAgentEnabled("mm-code", true)).rejects.toThrow();
    expect(get(agents).find((a) => a.name === "mm-code")?.deactivated).toBe(true);
  });
});
