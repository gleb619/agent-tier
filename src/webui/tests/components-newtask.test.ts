import { fireEvent, render, screen, within } from "@testing-library/svelte";
import { tick } from "svelte";
import { get } from "svelte/store";
import { beforeEach, describe, expect, it } from "vitest";
import NewTaskView from "../components/newtask/NewTaskView.svelte";
import { agents } from "../stores/dashboard";
import { runs, selectedRunId, selectRun, setRuns } from "../stores/runs";
import { DEFAULT_SETTINGS, settings } from "../stores/settings";
import { toasts } from "../stores/toast";
import { currentView } from "../stores/ui";
import type { ApiAgent, ApiRun } from "../types/api";
import { MAX_PROMPT_CHARS, MAX_RETRIES, validateNewTask } from "../utils/newtask";

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

function makeRun(id: string, partial: Partial<ApiRun> = {}): ApiRun {
  return {
    runId: id,
    agent: "mm-code",
    tier: 2,
    pid: 1,
    prompt: `prompt ${id}`,
    logFile: `/tmp/${id}.log`,
    startedAt: new Date(Date.now() - 60_000).toISOString(),
    finishedAt: null,
    exitCode: null,
    status: "running",
    name: `Run ${id}`,
    ...partial,
  };
}

/** fetch mock routing by URL: POST /api/runs -> 202, GET /api/runs -> provided list. */
function stubFetch(runsList: ApiRun[] = []): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (input: unknown) => {
    const url = String(input);
    if (url === "/api/runs" || url.startsWith("/api/runs?")) {
      return new Response(JSON.stringify(runsList), { status: 200 });
    }
    if (url === "/api/agents") {
      return new Response(JSON.stringify([]), { status: 200 });
    }
    if (url === "/api/stats") {
      return new Response(JSON.stringify({}), { status: 200 });
    }
    return new Response(JSON.stringify({ ok: true }), { status: 202 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function postCalls(fetchMock: ReturnType<typeof vi.fn>): { body: Record<string, unknown> }[] {
  return fetchMock.mock.calls
    .filter((c) => String(c[0]) === "/api/runs" && (c[1] as RequestInit | undefined)?.method === "POST")
    .map((c) => ({ body: JSON.parse(String((c[1] as RequestInit).body)) as Record<string, unknown> }));
}

beforeEach(() => {
  setRuns([]);
  selectRun(null);
  agents.set([makeAgent("mm-code"), makeAgent("codex", { tier: 1 })]);
  settings.set({ ...DEFAULT_SETTINGS });
  toasts.set([]);
  currentView.set("new-task");
  vi.unstubAllGlobals();
});

describe("validateNewTask", () => {
  const valid = { prompt: "fix the bug", tier: 2, agent: "mm-code", mode: "stream", retries: 0 };

  it("rejects an empty or whitespace-only prompt", () => {
    expect(validateNewTask({ ...valid, prompt: "" })).toMatch(/prompt/i);
    expect(validateNewTask({ ...valid, prompt: "   " })).toMatch(/prompt/i);
  });

  it("rejects prompts over the character cap", () => {
    expect(validateNewTask({ ...valid, prompt: "x".repeat(MAX_PROMPT_CHARS + 1) })).toMatch(/too long/i);
    expect(validateNewTask({ ...valid, prompt: "x".repeat(MAX_PROMPT_CHARS) })).toBeNull();
  });

  it("bounds tier to 1-4 or null (auto)", () => {
    for (const tier of [0, 5, 1.5, -1]) {
      expect(validateNewTask({ ...valid, tier })).toMatch(/tier/i);
    }
    expect(validateNewTask({ ...valid, tier: null })).toBeNull();
    expect(validateNewTask({ ...valid, tier: 4 })).toBeNull();
  });

  it("bounds mode to stream|block|detached", () => {
    expect(validateNewTask({ ...valid, mode: "bogus" })).toMatch(/mode/i);
    for (const mode of ["stream", "block", "detached"]) {
      expect(validateNewTask({ ...valid, mode })).toBeNull();
    }
  });

  it("bounds retries to an integer within 0-MAX_RETRIES", () => {
    for (const retries of [-1, MAX_RETRIES + 1, 1.5]) {
      expect(validateNewTask({ ...valid, retries })).toMatch(/retries/i);
    }
    expect(validateNewTask({ ...valid, retries: MAX_RETRIES })).toBeNull();
  });

  it("rejects an unknown agent but allows empty (auto)", () => {
    const known = ["mm-code", "codex"];
    expect(validateNewTask({ ...valid, agent: "nope" }, known)).toMatch(/agent/i);
    expect(validateNewTask({ ...valid, agent: "" }, known)).toBeNull();
    expect(validateNewTask({ ...valid, agent: "codex" }, known)).toBeNull();
  });
});

describe("NewTaskView", () => {
  it("renders prompt, tier, agent, mode and retries controls with settings defaults", async () => {
    settings.set({ ...DEFAULT_SETTINGS, defaultTier: 3, defaultAgent: "codex", runMode: "block", retries: 2 });
    render(NewTaskView);
    await tick();

    expect(screen.getByTestId("prompt-input")).toHaveValue("");
    expect(screen.getByLabelText("Tier")).toHaveValue("3");
    expect(screen.getByLabelText("Agent")).toHaveValue("codex");
    expect(screen.getByLabelText("Mode")).toHaveValue("block");
    expect(screen.getByLabelText("Retries")).toHaveValue(2);
  });

  it("populates the agent dropdown from the agents store with an Auto option", () => {
    render(NewTaskView);
    const select = screen.getByLabelText("Agent");
    const optionValues = within(select)
      .getAllByRole("option")
      .map((o) => (o as HTMLOptionElement).value);
    expect(optionValues).toEqual(["", "mm-code", "codex"]);
  });

  it("shows a live character count", async () => {
    render(NewTaskView);
    expect(screen.getByTestId("prompt-count")).toHaveTextContent(`0 / ${MAX_PROMPT_CHARS}`);
    await fireEvent.input(screen.getByTestId("prompt-input"), { target: { value: "abc" } });
    expect(screen.getByTestId("prompt-count")).toHaveTextContent(`3 / ${MAX_PROMPT_CHARS}`);
  });

  it("rejects an empty prompt without calling the API", async () => {
    const fetchMock = stubFetch();
    render(NewTaskView);
    await fireEvent.click(screen.getByRole("button", { name: /start run/i }));
    expect(screen.getByRole("alert")).toHaveTextContent(/prompt/i);
    expect(postCalls(fetchMock)).toHaveLength(0);
  });

  it("submits POST /api/runs with prompt, agent and tier, then navigates to the run", async () => {
    const fetchMock = stubFetch([makeRun("fresh")]);
    render(NewTaskView);

    await fireEvent.input(screen.getByTestId("prompt-input"), { target: { value: "fix the bug" } });
    await fireEvent.change(screen.getByLabelText("Tier"), { target: { value: "1" } });
    await fireEvent.change(screen.getByLabelText("Agent"), { target: { value: "codex" } });
    await fireEvent.click(screen.getByRole("button", { name: /start run/i }));

    const posts = postCalls(fetchMock);
    expect(posts).toHaveLength(1);
    expect(posts[0]!.body).toEqual({ prompt: "fix the bug", agent: "codex", tier: 1 });

    await vi.waitFor(() => expect(get(currentView)).toBe("run-details"));
    expect(get(selectedRunId)).toBe("fresh");
    expect(get(toasts).some((t) => /started/i.test(t.message))).toBe(true);
  });

  it("submits with Ctrl+Enter from the textarea", async () => {
    const fetchMock = stubFetch([makeRun("fresh")]);
    render(NewTaskView);
    await fireEvent.input(screen.getByTestId("prompt-input"), { target: { value: "do it" } });
    await fireEvent.keyDown(screen.getByTestId("prompt-input"), { key: "Enter", ctrlKey: true });
    expect(postCalls(fetchMock)).toHaveLength(1);
    await vi.waitFor(() => expect(get(currentView)).toBe("run-details"));
  });

  it("omits agent and tier from the payload when set to Auto", async () => {
    const fetchMock = stubFetch([makeRun("fresh")]);
    render(NewTaskView);
    await fireEvent.input(screen.getByTestId("prompt-input"), { target: { value: "go" } });
    await fireEvent.change(screen.getByLabelText("Tier"), { target: { value: "" } });
    await fireEvent.change(screen.getByLabelText("Agent"), { target: { value: "" } });
    await fireEvent.click(screen.getByRole("button", { name: /start run/i }));
    expect(postCalls(fetchMock)[0]!.body).toEqual({ prompt: "go" });
  });

  it("surfaces API errors and stays on the form", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "prompt is required" }), { status: 400 })),
    );
    render(NewTaskView);
    await fireEvent.input(screen.getByTestId("prompt-input"), { target: { value: "x" } });
    await fireEvent.click(screen.getByRole("button", { name: /start run/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent("prompt is required");
    expect(get(currentView)).toBe("new-task");
  });

  it("navigates to the dashboard when no run shows up after submit", async () => {
    stubFetch([]);
    render(NewTaskView);
    await fireEvent.input(screen.getByTestId("prompt-input"), { target: { value: "go" } });
    await fireEvent.click(screen.getByRole("button", { name: /start run/i }));
    await vi.waitFor(() => expect(get(currentView)).toBe("dashboard"), { timeout: 8000 });
    expect(get(runs)).toHaveLength(0);
  }, 10_000);

  it("picks up the run on a later refetch when the detached spawn records it late", async () => {
    // First list fetch (immediately after POST) is too early; the second one
    // sees the recorded run. Prompt carries the submitted text (no global
    // prefix in tests).
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown, init?: RequestInit) => {
        const url = String(input);
        if (url === "/api/agents") return new Response(JSON.stringify([]), { status: 200 });
        if (url === "/api/runs" && (init?.method ?? "GET") === "GET") {
          calls += 1;
          return new Response(JSON.stringify(calls >= 2 ? [makeRun("late", { prompt: "fix the bug" })] : []), {
            status: 200,
          });
        }
        return new Response(JSON.stringify({ ok: true }), { status: 202 });
      }),
    );
    render(NewTaskView);
    await fireEvent.input(screen.getByTestId("prompt-input"), { target: { value: "fix the bug" } });
    await fireEvent.click(screen.getByRole("button", { name: /start run/i }));
    await vi.waitFor(() => expect(get(currentView)).toBe("run-details"), { timeout: 8000 });
    expect(get(selectedRunId)).toBe("late");
    expect(get(runs).map((r) => r.runId)).toEqual(["late"]);
  }, 10_000);

  it("keeps polling past pre-existing runs until the newly recorded run shows up", async () => {
    // The store already holds an older run; the first post-submit fetch only
    // sees that one, so the loop must not stop there — the second fetch
    // reveals the run recorded by the detached spawn.
    setRuns([makeRun("old")]);
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown, init?: RequestInit) => {
        const url = String(input);
        if (url === "/api/agents") return new Response(JSON.stringify([]), { status: 200 });
        if (url === "/api/runs" && (init?.method ?? "GET") === "GET") {
          calls += 1;
          const list = calls >= 2 ? [makeRun("newest", { prompt: "ship it" }), makeRun("old")] : [makeRun("old")];
          return new Response(JSON.stringify(list), { status: 200 });
        }
        return new Response(JSON.stringify({ ok: true }), { status: 202 });
      }),
    );
    render(NewTaskView);
    await fireEvent.input(screen.getByTestId("prompt-input"), { target: { value: "ship it" } });
    await fireEvent.click(screen.getByRole("button", { name: /start run/i }));
    await vi.waitFor(() => expect(get(currentView)).toBe("run-details"), { timeout: 8000 });
    expect(get(selectedRunId)).toBe("newest");
  }, 10_000);
});
