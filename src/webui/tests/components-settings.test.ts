import { fireEvent, render, screen } from "@testing-library/svelte";
import { tick } from "svelte";
import { get } from "svelte/store";
import { beforeEach, describe, expect, it } from "vitest";
import SettingsView from "../components/settings/SettingsView.svelte";
import { agents } from "../stores/dashboard";
import { DEFAULT_SETTINGS, settings } from "../stores/settings";
import { toasts } from "../stores/toast";
import type { ApiAgent } from "../types/api";
import { MAX_RETRIES } from "../utils/newtask";

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

/** fetch mock: GET /api/settings → storedBody, PUT /api/settings → echoes the body back. */
function stubFetch(storedBody: Record<string, unknown> = {}): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (_input: unknown, init?: RequestInit) => {
    if ((init?.method ?? "GET") === "PUT") {
      return new Response(init?.body as string, { status: 200 });
    }
    return new Response(JSON.stringify(storedBody), { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function putCalls(fetchMock: ReturnType<typeof vi.fn>): Record<string, unknown>[] {
  return fetchMock.mock.calls
    .filter((c) => String(c[0]) === "/api/settings" && (c[1] as RequestInit | undefined)?.method === "PUT")
    .map((c) => JSON.parse(String((c[1] as RequestInit).body)) as Record<string, unknown>);
}

beforeEach(() => {
  settings.set({ ...DEFAULT_SETTINGS });
  agents.set([makeAgent("mm-code"), makeAgent("codex", { tier: 1 })]);
  toasts.set([]);
  stubFetch();
});

describe("SettingsView", () => {
  it("loads backend settings into the form fields", async () => {
    stubFetch({ defaultTier: 3, defaultAgent: "codex", runMode: "block", retries: 2, autoRefresh: false });
    render(SettingsView);

    await vi.waitFor(() => expect(screen.getByLabelText("Tier")).toHaveValue("3"));
    expect(screen.getByLabelText("Agent")).toHaveValue("codex");
    expect(screen.getByLabelText("Mode")).toHaveValue("block");
    expect(screen.getByLabelText("Retries")).toHaveValue(2);
    expect(screen.getByRole("switch", { name: "Auto-refresh" })).toHaveAttribute("aria-checked", "false");
  });

  it("populates the agent dropdown from the agents store with an Auto option", async () => {
    render(SettingsView);
    await tick();
    const optionValues = Array.from(screen.getByLabelText("Agent").querySelectorAll("option")).map((o) => o.value);
    expect(optionValues).toEqual(["", "mm-code", "codex"]);
  });

  it("shows inline validation feedback and blocks saving on invalid input", async () => {
    const fetchMock = stubFetch();
    render(SettingsView);
    await tick();

    await fireEvent.input(screen.getByLabelText("Retries"), { target: { value: String(MAX_RETRIES + 1) } });
    expect(screen.getByRole("alert")).toHaveTextContent(/retries/i);

    await fireEvent.click(screen.getByRole("button", { name: /save/i }));
    expect(putCalls(fetchMock)).toHaveLength(0);

    await fireEvent.input(screen.getByLabelText("Retries"), { target: { value: "1" } });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("PUTs coerced settings to /api/settings and shows a success toast", async () => {
    const fetchMock = stubFetch();
    render(SettingsView);
    await vi.waitFor(() => expect(get(settings)).toEqual(expect.objectContaining({ defaultTier: 2 }))); // load done

    await fireEvent.change(screen.getByLabelText("Mode"), { target: { value: "detached" } });
    await fireEvent.click(screen.getByRole("button", { name: /save/i }));

    await vi.waitFor(() => expect(putCalls(fetchMock)).toHaveLength(1));
    expect(putCalls(fetchMock)[0]).toMatchObject({
      defaultTier: 2,
      defaultAgent: "mm-code",
      runMode: "detached",
      retries: 0,
      autoRefresh: true,
    });
    await vi.waitFor(() => expect(get(toasts).some((t) => /saved/i.test(t.message))).toBe(true));
  });

  it("round-trips advanced SSE port, log dir and state dir", async () => {
    const fetchMock = stubFetch();
    render(SettingsView);
    await vi.waitFor(() => expect(get(settings)).toEqual(expect.objectContaining({ defaultTier: 2 }))); // load done

    await fireEvent.input(screen.getByLabelText("SSE port"), { target: { value: "7800" } });
    await fireEvent.input(screen.getByLabelText("Log dir"), { target: { value: "/tmp/logs" } });
    await fireEvent.input(screen.getByLabelText("State dir"), { target: { value: "/tmp/state" } });
    await fireEvent.click(screen.getByRole("button", { name: /save/i }));

    await vi.waitFor(() => expect(putCalls(fetchMock)).toHaveLength(1));
    await vi.waitFor(() =>
      expect(putCalls(fetchMock)[0]).toMatchObject({ ssePort: 7800, logDir: "/tmp/logs", stateDir: "/tmp/state" }),
    );
    await vi.waitFor(() => expect(get(settings)).toMatchObject({ ssePort: 7800, logDir: "/tmp/logs", stateDir: "/tmp/state" }));
  });

  it("renders read-only entries for keys the form does not edit", async () => {
    stubFetch({ configPath: "/home/u/.at/config.json", webui: { theme: "dark" } });
    render(SettingsView);

    await vi.waitFor(() => expect(screen.getByText("configPath")).toBeInTheDocument());
    expect(screen.getByText("/home/u/.at/config.json")).toBeInTheDocument();
    expect(screen.getByText("webui")).toBeInTheDocument();
    expect(screen.getByText('{"theme":"dark"}')).toBeInTheDocument();
    expect(screen.queryByLabelText("ConfigPath")).not.toBeInTheDocument();
  });

  it("surfaces API errors as an error toast and keeps the form", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "disk full" }), { status: 500 })),
    );
    render(SettingsView);
    await vi.waitFor(() => expect(get(settings)).toEqual(expect.objectContaining({ defaultTier: 2 }))); // load done (500 on GET is swallowed)

    await fireEvent.click(screen.getByRole("button", { name: /save/i }));
    await vi.waitFor(() => expect(get(toasts).some((t) => t.message === "disk full" && t.kind === "error")).toBe(true));
    expect(screen.getByLabelText("Tier")).toHaveValue("2");
  });
});
