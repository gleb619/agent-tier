import { fireEvent, render, screen, within } from "@testing-library/svelte";
import { tick } from "svelte";
import { get } from "svelte/store";
import { beforeEach, describe, expect, it } from "vitest";
import RunItem from "../components/sidebar/RunItem.svelte";
import RunList from "../components/sidebar/RunList.svelte";
import { agentFilter, searchQuery, statusFilter } from "../stores/filters";
import { selectedRunId, selectRun, setRuns } from "../stores/runs";
import { currentView } from "../stores/ui";
import type { ApiRun } from "../types/api";

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

beforeEach(() => {
  setRuns([]);
  selectRun(null);
  statusFilter.set("all");
  agentFilter.set("all");
  searchQuery.set("");
  currentView.set("dashboard");
});

describe("RunItem", () => {
  it("renders status icon, name, agent, tier and duration", () => {
    render(RunItem, { props: { run: makeRun("abc") } });
    expect(screen.getByText("Run abc")).toBeInTheDocument();
    expect(screen.getByText("mm-code")).toBeInTheDocument();
    expect(screen.getByText("T2")).toBeInTheDocument();
    expect(screen.getByText("2m 00s")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Run abc/ })).toHaveAttribute("aria-pressed", "false");
  });

  it("marks a running run with aria-pressed highlight when selected", () => {
    render(RunItem, {
      props: { run: makeRun("abc", { status: "running", finishedAt: null }), selected: true },
    });
    expect(screen.getByRole("button", { name: /Run abc/ })).toHaveAttribute("aria-pressed", "true");
  });

  it("invokes onSelect when clicked", async () => {
    let clicked = 0;
    render(RunItem, { props: { run: makeRun("abc"), onSelect: () => clicked++ } });
    await fireEvent.click(screen.getByRole("button", { name: /Run abc/ }));
    expect(clicked).toBe(1);
  });
});

describe("RunItem layout (grid alignment brief)", () => {
  it("uses a grid container with explicit column tracks so status/name/agent/tier/duration align vertically", () => {
    render(RunItem, { props: { run: makeRun("abc") } });
    const btn = screen.getByRole("button", { name: /Run abc/ });
    expect(btn.className).toMatch(/\bgrid\b/);
    // Inline grid-template-columns makes columns explicit, not auto.
    expect(btn.getAttribute("style") ?? "").toMatch(/grid-template-columns/);
  });

  it("truncates long names and exposes full name via the title attribute", () => {
    const LONG = "very-long-task-name-that-should-definitely-overflow-any-narrow-column";
    const { container } = render(RunItem, {
      props: { run: makeRun("abc", { name: LONG }) },
    });
    const nameEl = container.querySelector('[data-testid="run-name"]') as HTMLElement | null;
    expect(nameEl).not.toBeNull();
    expect(nameEl!.className).toMatch(/truncate/);
    expect(nameEl!.textContent).toBe(LONG);
    expect(nameEl!.getAttribute("title")).toBe(LONG);
  });

  it("renders tier in a compact pill (small font + thin padding)", () => {
    const { container } = render(RunItem, { props: { run: makeRun("abc") } });
    const tier = container.querySelector('[data-testid="run-tier"]') as HTMLElement | null;
    expect(tier).not.toBeNull();
    // pill: thin padding + small font (matches the brief's noise reduction)
    expect(tier!.className).toMatch(/\btext-\[10px\]|text-xs/);
    expect(tier!.className).toMatch(/px-1\.5|px-1\b/);
    expect(tier!.textContent?.trim()).toBe("T2");
  });

  it("renders duration with tabular-nums alignment", () => {
    render(RunItem, { props: { run: makeRun("abc") } });
    const dur = screen.getByTestId("run-duration");
    expect(dur.className).toMatch(/tabular-nums/);
    expect(dur.className).toMatch(/font-mono/);
  });
});

describe("RunList", () => {
  it("groups runs by date, newest day first", () => {
    setRuns([
      makeRun("old", { startedAt: new Date(NOW - 3 * 86400000).toISOString() }),
      makeRun("today-1"),
      makeRun("today-2", { startedAt: new Date(NOW - 5 * MIN).toISOString() }),
    ]);
    render(RunList);
    const headers = screen.getAllByTestId("group-header").map((h) => h.textContent);
    expect(headers[0]).toBe("Today");
    expect(headers[1]).toMatch(/Oct \d+/);
  });

  it("reflects the filters store", () => {
    setRuns([makeRun("ok"), makeRun("bad", { status: "failed", exitCode: 1 })]);
    searchQuery.set("ok");
    render(RunList);
    expect(screen.getByRole("button", { name: /Run ok/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Run bad/ })).not.toBeInTheDocument();
  });

  it("ANDs whitespace-separated search tokens across name/agent/prompt/runId", async () => {
    setRuns([
      makeRun("abc", { name: "Refactor auth", agent: "mm-code", prompt: "touch login" }),
      makeRun("xyz", { name: "Refactor db", agent: "qwen", prompt: "migrate login" }),
      makeRun("nope", { name: "Add tests", agent: "kilo", prompt: "vitest suite" }),
    ]);
    searchQuery.set("refactor login");
    render(RunList);
    expect(screen.getByRole("button", { name: /Refactor auth/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Refactor db/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Add tests/ })).not.toBeInTheDocument();

    searchQuery.set("tests vitest");
    await tick();
    expect(screen.queryByRole("button", { name: /Refactor auth/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Refactor db/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Add tests/ })).toBeInTheDocument();
  });

  it("selects the run and navigates to run-details on click", async () => {
    setRuns([makeRun("abc")]);
    render(RunList);
    await fireEvent.click(screen.getByRole("button", { name: /Run abc/ }));
    expect(get(selectedRunId)).toBe("abc");
    expect(get(currentView)).toBe("run-details");
  });

  it("shows an empty state when nothing matches", () => {
    setRuns([makeRun("abc")]);
    searchQuery.set("zzz-no-match");
    render(RunList);
    expect(screen.getByTestId("run-list-empty")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("virtualizes long lists (>50 rows render only a window)", async () => {
    const runs = Array.from({ length: 80 }, (_, i) => makeRun(`r${String(i).padStart(2, "0")}`));
    setRuns(runs);
    render(RunList);
    const items = screen.getAllByTestId("run-item");
    expect(items.length).toBeGreaterThan(0);
    expect(items.length).toBeLessThan(80);
    // scrolling down reveals later rows
    const scroller = screen.getByTestId("run-list-scroll");
    await fireEvent.scroll(scroller, { target: { scrollTop: 100000 } });
    const after = screen.getAllByTestId("run-item");
    expect(after.length).toBeGreaterThan(0);
    // scrolled to the very bottom: the oldest window (r75–r79) is rendered
    expect(after[after.length - 1]?.textContent).toContain("r79");
  });

  it("renders short lists fully without virtualization", () => {
    setRuns([makeRun("a"), makeRun("b")]);
    render(RunList);
    const list = screen.getByTestId("run-list");
    expect(within(list).getAllByTestId("run-item")).toHaveLength(2);
  });
});
