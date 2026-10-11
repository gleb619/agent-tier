import { fireEvent, render, screen, waitFor, within } from "@testing-library/svelte";
import { get } from "svelte/store";
import { beforeEach, describe, expect, it, vi } from "vitest";
import DiscussPanel from "../components/run/DiscussPanel.svelte";
import LogViewer from "../components/run/LogViewer.svelte";
import RunDetailsView from "../components/run/RunDetailsView.svelte";
import RunMeta from "../components/run/RunMeta.svelte";
import { createRunDetailsSession } from "../stores/run-details";
import { selectedRunId, selectRun, setRuns } from "../stores/runs";
import { toasts } from "../stores/toast";
import type { ApiDiscussEntry, ApiRun } from "../types/api";

function makeRun(id: string, partial: Partial<ApiRun> = {}): ApiRun {
  return {
    runId: id,
    agent: "mm-code",
    tier: 2,
    pid: 4242,
    prompt: `do ${id}`,
    logFile: `/tmp/${id}.log`,
    startedAt: "2026-10-11T10:00:00.000Z",
    finishedAt: null,
    exitCode: null,
    status: "running",
    name: `Run ${id}`,
    ...partial,
  };
}

/** fetch mock: log tail, discuss thread, retry/delete. */
function stubFetch(opts: { logLines?: string[]; pending?: ApiDiscussEntry[] } = {}): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (/\/api\/runs\/[^/]+\/log/.test(url)) {
      return new Response(JSON.stringify({ runId: "r1", lines: opts.logLines ?? [] }), { status: 200 });
    }
    if (/\/api\/runs\/[^/]+\/discuss\?pending=1/.test(url)) {
      return new Response(JSON.stringify(opts.pending ?? []), { status: 200 });
    }
    if (/\/api\/runs\/[^/]+\/discuss/.test(url) && method === "POST") {
      return new Response(JSON.stringify({ id: "m2" }), { status: 202 });
    }
    if (/\/api\/runs\/[^/]+\/retry/.test(url)) {
      return new Response(JSON.stringify({ ok: true }), { status: 202 });
    }
    if (/^\/api\/runs\//.test(url) && method === "DELETE") {
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    return new Response(JSON.stringify({ error: "unexpected" }), { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function makeQuestion(partial: Partial<ApiDiscussEntry> = {}): ApiDiscussEntry {
  return {
    id: "m1",
    from: "agent",
    kind: "question",
    text: "which port should I use?",
    ts: "2026-10-11T10:01:00.000Z",
    ...partial,
  };
}

beforeEach(() => {
  setRuns([]);
  selectRun(null);
  toasts.set([]);
  vi.unstubAllGlobals();
});

describe("RunMeta", () => {
  it("shows name, id, agent, tier, pid, status, timestamps and duration", () => {
    render(RunMeta, { run: makeRun("r1", { finishedAt: "2026-10-11T11:00:00.000Z", exitCode: 0, status: "done" }) });
    expect(screen.getByText("Run r1")).toBeInTheDocument();
    expect(screen.getByText("r1")).toBeInTheDocument();
    expect(screen.getByText("mm-code")).toBeInTheDocument();
    expect(screen.getByText("T2")).toBeInTheDocument();
    expect(screen.getByText("4242")).toBeInTheDocument();
    expect(screen.getByText("done")).toBeInTheDocument();
    expect(screen.getByText("0")).toBeInTheDocument();
    expect(screen.getByText("1h 00m")).toBeInTheDocument();
  });

  it("renders stuck status and dash for missing exit code", () => {
    render(RunMeta, { run: makeRun("r1", { status: "stuck", exitCode: null }) });
    expect(screen.getByText("stuck")).toBeInTheDocument();
    // Exit code and Finished are both unset.
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(2);
  });
});

describe("LogViewer", () => {
  async function renderViewer(logLines: string[]) {
    stubFetch({ logLines });
    const session = createRunDetailsSession("r1");
    await session.refresh();
    render(LogViewer, { session, run: makeRun("r1") });
    return session;
  }

  it("renders numbered log lines", async () => {
    await renderViewer(["first line", "second line"]);
    const row1 = document.querySelector('[data-line="1"]');
    expect(row1?.textContent).toContain("1");
    expect(row1?.textContent).toContain("first line");
    expect(document.querySelector('[data-line="2"]')?.textContent).toContain("second line");
    expect(screen.getByTestId("match-count")).toHaveTextContent("0 / 0");
  });

  it("shows an empty state when there is no output", async () => {
    await renderViewer([]);
    expect(screen.getByTestId("log-empty")).toHaveTextContent(/no log output/i);
  });

  it("search filters lines and highlights matches", async () => {
    await renderViewer(["npm error: boom", "all good", "another ERROR here"]);
    const search = screen.getByTestId("log-search");
    await fireEvent.input(search, { target: { value: "error" } });

    expect(document.querySelector('[data-line="1"]')?.textContent).toContain("npm error: boom");
    expect(screen.queryByText("all good")).not.toBeInTheDocument();
    // No match navigated yet → position defaults to the first of two matches.
    expect(screen.getByTestId("match-count")).toHaveTextContent("1 / 2");
    // Highlighted segments carry the mark styling.
    const marks = document.querySelectorAll('[data-testid="log-viewer"] .mark');
    expect(marks.length).toBeGreaterThanOrEqual(2);
  });

  it("arrow buttons step through matches in order", async () => {
    await renderViewer(["npm error: boom", "all good", "another ERROR here"]);
    const search = screen.getByTestId("log-search");
    await fireEvent.input(search, { target: { value: "error" } });

    const down = screen.getByRole("button", { name: "↓" });
    await fireEvent.click(down);
    expect(screen.getByTestId("match-count")).toHaveTextContent("1 / 2");
    await fireEvent.click(down);
    expect(screen.getByTestId("match-count")).toHaveTextContent("2 / 2");
    // Wraps back to the first match.
    await fireEvent.click(down);
    expect(screen.getByTestId("match-count")).toHaveTextContent("1 / 2");
  });

  it("copy copies the whole buffer to the clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    await renderViewer(["alpha", "beta"]);
    await fireEvent.click(screen.getByRole("button", { name: /copy/i }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("alpha\nbeta"));
    expect(get(toasts).some((t) => /copied/i.test(t.message))).toBe(true);
  });

  it("download creates a blob link and clicks it", async () => {
    const createObjectURL = vi.fn(() => "blob:fake");
    const revokeObjectURL = vi.fn();
    const click = vi.fn();
    vi.stubGlobal("URL", { ...URL, createObjectURL, revokeObjectURL });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(click);
    await renderViewer(["alpha"]);
    await fireEvent.click(screen.getByRole("button", { name: /download/i }));
    await waitFor(() => expect(createObjectURL).toHaveBeenCalledTimes(1));
    expect(click).toHaveBeenCalledTimes(1);
  });
});

describe("DiscussPanel", () => {
  async function renderPanel(pending: ApiDiscussEntry[]) {
    const fetchMock = stubFetch({ pending });
    const session = createRunDetailsSession("r1");
    render(DiscussPanel, { session, run: makeRun("r1") });
    await waitFor(() => expect(screen.getByTestId("discuss-panel")).toBeInTheDocument());
    return fetchMock;
  }

  it("shows an empty state when there are no pending questions", async () => {
    await renderPanel([]);
    await waitFor(() => expect(screen.getByTestId("discuss-empty")).toBeInTheDocument());
  });

  it("lists pending questions and submits typed answers as host answers", async () => {
    const fetchMock = await renderPanel([makeQuestion()]);
    await waitFor(() => expect(screen.getByTestId("discuss-question")).toBeInTheDocument());

    await fireEvent.input(screen.getByLabelText("Answer to m1"), { target: { value: "use 7800" } });
    await fireEvent.click(screen.getByRole("button", { name: /^send$/i }));

    const posts = fetchMock.mock.calls.filter(
      (c) => /\/api\/runs\/[^/]+\/discuss$/.test(String(c[0])) && (c[1] as RequestInit).method === "POST",
    );
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(JSON.parse(String((posts[0]![1] as RequestInit).body))).toEqual({
      kind: "answer",
      text: "use 7800",
      replyTo: "m1",
    });
    await waitFor(() => expect(get(toasts).some((t) => /answer sent/i.test(t.message))).toBe(true));
  });

  it("renders question options as quick-answer buttons", async () => {
    const fetchMock = await renderPanel([makeQuestion({ options: ["yes", "no"] })]);
    await waitFor(() => expect(screen.getByRole("button", { name: "yes" })).toBeInTheDocument());
    await fireEvent.click(screen.getByRole("button", { name: "yes" }));
    const posts = fetchMock.mock.calls.filter(
      (c) => /\/api\/runs\/[^/]+\/discuss$/.test(String(c[0])) && (c[1] as RequestInit).method === "POST",
    );
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(JSON.parse(String((posts[0]![1] as RequestInit).body))).toEqual({
      kind: "answer",
      text: "yes",
      replyTo: "m1",
    });
  });
});

describe("RunDetailsView", () => {
  it("prompts to select a run when nothing is selected", () => {
    render(RunDetailsView);
    expect(screen.getByTestId("no-run-selected")).toBeInTheDocument();
  });

  it("renders meta, log, discuss and actions for the selected run, and loads its log", async () => {
    const fetchMock = stubFetch({ logLines: ["hello log"], pending: [makeQuestion()] });
    setRuns([makeRun("r1")]);
    selectRun("r1");
    render(RunDetailsView);

    expect(await screen.findByTestId("run-meta")).toBeInTheDocument();
    expect(screen.getByTestId("log-viewer")).toBeInTheDocument();
    expect(screen.getByTestId("discuss-panel")).toBeInTheDocument();
    await waitFor(() => expect(fetchMock.mock.calls.some((c) => /\/api\/runs\/r1\/log/.test(String(c[0])))).toBe(true));
    expect(await screen.findByText("hello log")).toBeInTheDocument();
    expect(await screen.findByTestId("discuss-question")).toBeInTheDocument();
    expect(get(selectedRunId)).toBe("r1");
  });

  it("retry posts to the retry endpoint", async () => {
    const fetchMock = stubFetch({ logLines: [] });
    setRuns([makeRun("r1")]);
    selectRun("r1");
    render(RunDetailsView);
    await fireEvent.click(await screen.findByRole("button", { name: /^retry$/i }));
    await waitFor(() =>
      expect(fetchMock.mock.calls.some((c) => /\/api\/runs\/r1\/retry/.test(String(c[0])))).toBe(true),
    );
    await waitFor(() => expect(get(toasts).some((t) => /retry started/i.test(t.message))).toBe(true));
  });

  it("kill asks for confirmation before deleting", async () => {
    const fetchMock = stubFetch({ logLines: [] });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    setRuns([makeRun("r1")]);
    selectRun("r1");
    render(RunDetailsView);
    await fireEvent.click(await screen.findByRole("button", { name: /^kill$/i }));
    expect(fetchMock.mock.calls.some((c) => (c[1] as RequestInit | undefined)?.method === "DELETE")).toBe(false);

    confirm.mockReturnValue(true);
    await fireEvent.click(screen.getByRole("button", { name: /^kill$/i }));
    await waitFor(() =>
      expect(fetchMock.mock.calls.some((c) => (c[1] as RequestInit | undefined)?.method === "DELETE")).toBe(true),
    );
    await waitFor(() => expect(get(toasts).some((t) => /killed/i.test(t.message))).toBe(true));
  });

  it("show prompt reveals the run prompt and hides it again", async () => {
    stubFetch({ logLines: [] });
    setRuns([makeRun("r1", { prompt: "fix the flaky test" })]);
    selectRun("r1");
    render(RunDetailsView);
    expect(screen.queryByTestId("run-prompt")).not.toBeInTheDocument();
    await fireEvent.click(await screen.findByRole("button", { name: /show prompt/i }));
    expect(screen.getByTestId("run-prompt")).toHaveTextContent("fix the flaky test");
    await fireEvent.click(screen.getByRole("button", { name: /hide prompt/i }));
    expect(screen.queryByTestId("run-prompt")).not.toBeInTheDocument();
  });

  it("renders filtered log rows when the run has a large buffer", async () => {
    stubFetch({ logLines: Array.from({ length: 100 }, (_, i) => `line ${i}`) });
    setRuns([makeRun("r1")]);
    selectRun("r1");
    render(RunDetailsView);
    const viewer = await screen.findByTestId("log-viewer");
    await waitFor(() => expect(within(viewer).getByText("line 0")).toBeInTheDocument());
    // Virtualized: only the viewport window is in the DOM, not all 100 rows.
    expect(within(viewer).getAllByText(/^line \d+$/).length).toBeLessThan(100);
    expect(within(viewer).queryByText("line 99")).not.toBeInTheDocument();
  });
});
