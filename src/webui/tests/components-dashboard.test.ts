import { fireEvent, render, screen, within } from "@testing-library/svelte";
import { get } from "svelte/store";
import { beforeEach, describe, expect, it } from "vitest";
import ActiveRuns from "../components/dashboard/ActiveRuns.svelte";
import AgentsPanel from "../components/dashboard/AgentsPanel.svelte";
import QuickStats from "../components/dashboard/QuickStats.svelte";
import RecentCompletions from "../components/dashboard/RecentCompletions.svelte";
import { agents, dashboardError, refreshDashboard, stats } from "../stores/dashboard";
import { selectedRunId, selectRun, setRuns } from "../stores/runs";
import { currentView } from "../stores/ui";
import type { ApiAgent, ApiRun, ApiStats } from "../types/api";

const NOW = Date.now();
const MIN = 60000;

function makeRun(id: string, partial: Partial<ApiRun> = {}): ApiRun {
  return {
    runId: id,
    agent: "mm-code",
    tier: 2,
    pid: 1,
    prompt: `prompt ${id}`,
    logFile: `/tmp/${id}.log`,
    startedAt: new Date(NOW - 10 * MIN).toISOString(),
    finishedAt: new Date(NOW - 8 * MIN).toISOString(),
    exitCode: 0,
    status: "done",
    name: `Run ${id}`,
    ...partial,
  };
}

function makeStats(partial: Partial<ApiStats> = {}): ApiStats {
  return {
    total: 4,
    running: 1,
    done: 2,
    failed: 1,
    stuck: 0,
    agents: { total: 14, deactivated: 1 },
    ...partial,
  };
}

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

beforeEach(() => {
  setRuns([]);
  selectRun(null);
  stats.set(null);
  agents.set([]);
  dashboardError.set(null);
  currentView.set("dashboard");
});

describe("QuickStats", () => {
  it("renders one tile per derived stat", () => {
    render(QuickStats, { props: { stats: makeStats() } });
    const tiles = screen.getAllByTestId("stat-tile");
    expect(tiles.length).toBeGreaterThanOrEqual(6);
    expect(within(tiles[0]!).getByText("Total runs")).toBeInTheDocument();
    expect(screen.getByText("67%")).toBeInTheDocument();
    expect(screen.getByText("13/14")).toBeInTheDocument();
  });
});

describe("ActiveRuns", () => {
  it("lists running runs and shows an empty state when none", () => {
    const { unmount } = render(ActiveRuns);
    expect(screen.getByTestId("active-runs-empty")).toHaveTextContent("No active runs");
    unmount();

    setRuns([
      makeRun("done-1"),
      makeRun("live", { status: "running", finishedAt: null }),
      makeRun("dead", { status: "failed", exitCode: 1 }),
    ]);
    render(ActiveRuns);
    expect(screen.queryByTestId("active-runs-empty")).not.toBeInTheDocument();
    expect(screen.getByText("Run live")).toBeInTheDocument();
    expect(screen.queryByText("Run done-1")).not.toBeInTheDocument();
  });

  it("clicking a run selects it and opens Run Details", async () => {
    setRuns([makeRun("live", { status: "running", finishedAt: null })]);
    render(ActiveRuns);
    await fireEvent.click(screen.getByRole("button", { name: /Run live/ }));
    expect(get(selectedRunId)).toBe("live");
    expect(get(currentView)).toBe("run-details");
  });
});

describe("RecentCompletions", () => {
  it("shows the newest finished runs, newest first, and navigates on click", async () => {
    setRuns([
      makeRun("older", { status: "done", finishedAt: new Date(NOW - 60 * MIN).toISOString() }),
      makeRun("fresh", { status: "failed", exitCode: 1, finishedAt: new Date(NOW - MIN).toISOString() }),
      makeRun("live", { status: "running", finishedAt: null }),
    ]);
    render(RecentCompletions);
    const buttons = screen.getAllByRole("button");
    expect(buttons.length).toBe(2);
    expect(within(buttons[0]!).getByText("Run fresh")).toBeInTheDocument();

    await fireEvent.click(buttons[0]!);
    expect(get(selectedRunId)).toBe("fresh");
    expect(get(currentView)).toBe("run-details");
  });
});

describe("AgentsPanel", () => {
  it("renders agent names, tiers and failure counts", () => {
    render(AgentsPanel, {
      props: { agents: [makeAgent("glm-code", { tier: 1, failures: 3 }), makeAgent("mock", { tier: 4 })] },
    });
    const row = screen.getByTestId("agent-glm-code");
    expect(within(row).getAllByText("glm-code").length).toBeGreaterThan(0);
    expect(within(row).getByText("T1")).toBeInTheDocument();
    expect(within(row).getByText("3 fails")).toBeInTheDocument();
  });

  it("reflects enabled/disabled state in the toggle", () => {
    render(AgentsPanel, {
      props: {
        agents: [
          makeAgent("ok"),
          makeAgent("off", { deactivated: true }),
          makeAgent("temp", { disabledTo: "2030-01-01T00:00:00Z" }),
        ],
      },
    });
    expect(within(screen.getByTestId("agent-ok")).getByRole("switch")).toHaveAttribute("aria-checked", "true");
    expect(within(screen.getByTestId("agent-off")).getByRole("switch")).toHaveAttribute("aria-checked", "false");
    expect(within(screen.getByTestId("agent-temp")).getByRole("switch")).toHaveAttribute("aria-checked", "false");
  });
});

describe("dashboard store", () => {
  it("refreshDashboard fills stats and agents from the API", async () => {
    const payload = { stats: makeStats(), agents: [makeAgent("glm-code")] };
    const fetchMock = vi.fn(async (_input: unknown) => new Response(JSON.stringify(payload.agents)));
    vi.stubGlobal("fetch", fetchMock);
    // First call (getStats) returns the stats object.
    fetchMock.mockImplementationOnce(async () => new Response(JSON.stringify(payload.stats)));

    await refreshDashboard();
    expect(get(stats)).toEqual(payload.stats);
    expect(get(agents)).toEqual(payload.agents);
    expect(fetchMock.mock.calls.map((c) => String(c[0]))).toEqual(["/api/stats", "/api/agents"]);
    vi.unstubAllGlobals();
  });

  it("keeps the previous data and sets dashboardError when the fetch fails", async () => {
    stats.set(makeStats());
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("boom", { status: 500 })),
    );
    await refreshDashboard();
    expect(get(stats)).not.toBeNull();
    expect(get(dashboardError)).toContain("HTTP 500");
    vi.unstubAllGlobals();
  });
});
