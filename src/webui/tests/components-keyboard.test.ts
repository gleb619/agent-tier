import { fireEvent, render, screen } from "@testing-library/svelte";
import { get } from "svelte/store";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { listRuns } from "../api/runs";
import MainLayout from "../components/layout/MainLayout.svelte";
import { runs, selectedRunId, selectRun, setRuns } from "../stores/runs";
import { currentView, setCurrentView } from "../stores/ui";
import type { ApiRun } from "../types/api";

vi.mock("../api/runs", () => ({
  listRuns: vi.fn(),
  retryRun: vi.fn(),
  deleteRun: vi.fn(),
}));

const listRunsMock = vi.mocked(listRuns);

function run(id: string, status: ApiRun["status"] = "done"): ApiRun {
  return {
    runId: id,
    name: `run ${id}`,
    agent: "glm-code",
    tier: 2,
    status,
    pid: 1000,
    exitCode: 0,
    startedAt: "2026-10-11T10:00:00Z",
    finishedAt: "2026-10-11T10:01:00Z",
    logFile: `/tmp/${id}.log`,
    prompt: `prompt ${id}`,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  listRunsMock.mockResolvedValue([run("a"), run("b"), run("c")]);
  setRuns([run("a"), run("b"), run("c")]);
  selectRun(null);
  window.history.pushState({}, "", "/");
  setCurrentView("dashboard");
});

describe("MainLayout keyboard shortcuts", () => {
  it("moves run selection with j/k and opens it with Enter", async () => {
    render(MainLayout);
    await fireEvent.keyDown(window, { key: "j" });
    expect(get(selectedRunId)).toBe("a");
    await fireEvent.keyDown(window, { key: "j" });
    expect(get(selectedRunId)).toBe("b");
    await fireEvent.keyDown(window, { key: "k" });
    expect(get(selectedRunId)).toBe("a");
    await fireEvent.keyDown(window, { key: "Enter" });
    expect(get(currentView)).toBe("run-details");
    expect(screen.getByRole("heading", { name: "Run Details" })).toBeInTheDocument();
  });

  it("clears the selection with Escape", async () => {
    selectRun("b");
    render(MainLayout);
    await fireEvent.keyDown(window, { key: "Escape" });
    expect(get(selectedRunId)).toBeNull();
  });

  it("retries and kills the selected run (Ctrl+k confirms first)", async () => {
    const { retryRun, deleteRun } = await import("../api/runs");
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    selectRun("b");
    render(MainLayout);

    await fireEvent.keyDown(window, { key: "r", ctrlKey: false });
    expect(retryRun).toHaveBeenCalledWith("b");

    await fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(confirmSpy).toHaveBeenCalled();
    expect(deleteRun).toHaveBeenCalledWith("b");

    confirmSpy.mockReturnValue(false);
    await fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(deleteRun).toHaveBeenCalledTimes(1);
    confirmSpy.mockRestore();
  });

  it("refreshes data with Ctrl+r", async () => {
    render(MainLayout);
    setRuns([]);
    await fireEvent.keyDown(window, { key: "r", ctrlKey: true });
    expect(listRunsMock).toHaveBeenCalled();
    expect(get(runs).map((r) => r.runId)).toEqual(["a", "b", "c"]);
  });

  it("focuses the filter input with /", async () => {
    render(MainLayout);
    await fireEvent.keyDown(window, { key: "/" });
    expect(document.activeElement).toBe(document.querySelector("#run-filter"));
  });

  it("focuses the filter input with Ctrl+F", async () => {
    render(MainLayout);
    await fireEvent.keyDown(window, { key: "f", ctrlKey: true });
    expect(document.activeElement).toBe(document.querySelector("#run-filter"));
  });

  it("still ignores shortcuts typed into form fields", async () => {
    render(MainLayout);
    const input = screen.getByLabelText("Filter runs");
    await fireEvent.keyDown(input, { key: "j" });
    expect(get(selectedRunId)).toBeNull();
  });

  it("focuses the filter with Ctrl+F even while typing in a textarea", async () => {
    render(MainLayout);
    const textarea = document.createElement("textarea");
    document.body.appendChild(textarea);
    textarea.focus();
    await fireEvent.keyDown(textarea, { key: "f", ctrlKey: true });
    expect(document.activeElement).toBe(document.querySelector("#run-filter"));
    textarea.remove();
  });

  it("keeps slashes typed in the filter as text", async () => {
    render(MainLayout);
    const input = screen.getByLabelText("Filter runs");
    input.focus();
    await fireEvent.keyDown(input, { key: "/" });
    expect(document.activeElement).toBe(input);
  });

  it("emits a show-prompt event for the details view on p", async () => {
    const seen = vi.fn();
    window.addEventListener("at:run-prompt", seen);
    render(MainLayout);
    await fireEvent.keyDown(window, { key: "p" });
    expect(seen).toHaveBeenCalledOnce();
    window.removeEventListener("at:run-prompt", seen);
  });

  it("reveals the selected run's prompt with p in the details view", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown) => {
        const url = String(input);
        if (/\/api\/runs\/[^/]+\/log/.test(url)) {
          return new Response(JSON.stringify({ runId: "a", lines: [] }), { status: 200 });
        }
        return new Response(JSON.stringify({ error: "unexpected" }), { status: 404 });
      }),
    );
    // Deep-link to run details so the router boots into the details view.
    selectRun("a");
    window.history.pushState({}, "", "/runs/a");
    render(MainLayout);
    await vi.waitFor(() => expect(screen.queryByTestId("run-details-view")).toBeInTheDocument());
    await fireEvent.keyDown(window, { key: "p" });
    expect(screen.getByTestId("run-prompt")).toHaveTextContent("prompt a");
    vi.unstubAllGlobals();
  });

  it("renders a skip link to the main content", () => {
    render(MainLayout);
    const link = screen.getByRole("link", { name: /skip to content/i });
    expect(link).toHaveAttribute("href", "#main");
    expect(document.getElementById("main")).not.toBeNull();
  });
});

describe("MainLayout a11y", () => {
  it("gives navigation and run-item buttons a visible focus ring", () => {
    render(MainLayout);
    const navButtons = screen.getAllByRole("button", { name: /Dashboard|New Task|Run Details|Agents|Settings/ });
    expect(navButtons.length).toBeGreaterThanOrEqual(5);
    for (const button of navButtons) expect(button.className).toMatch(/focus-visible:ring-2/);
  });

  it("keeps informational sidebar text at AA contrast (gray-500, not gray-400)", () => {
    setRuns([]);
    render(MainLayout);
    const empty = screen.getByTestId("run-list-empty");
    expect(empty.className).toContain("text-gray-500");
    expect(empty.className).not.toContain("text-gray-400");
  });
});
