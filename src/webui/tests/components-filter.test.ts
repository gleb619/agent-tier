import { fireEvent, render, screen } from "@testing-library/svelte";
import { get } from "svelte/store";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import FilterInput from "../components/sidebar/FilterInput.svelte";
import type { ApiRun } from "../types/api";
import { agentFilter, searchQuery, statusFilter } from "../stores/filters";
import { setRuns } from "../stores/runs";

function run(id: string, agent: string): ApiRun {
  return {
    runId: id,
    agent,
    tier: 2,
    pid: 1,
    prompt: "p",
    logFile: `/tmp/${id}.log`,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    exitCode: null,
    status: "running",
    name: id,
  };
}

beforeEach(() => {
  setRuns([run("a", "mm-code"), run("b", "codex")]);
  statusFilter.set("all");
  agentFilter.set("all");
  searchQuery.set("");
});

afterEach(() => {
  setRuns([]);
});

describe("FilterInput", () => {
  it("updates searchQuery while typing", async () => {
    render(FilterInput);
    const input = screen.getByLabelText("Filter runs");
    await fireEvent.input(input, { target: { value: "Login Bug" } });
    expect(get(searchQuery)).toBe("Login Bug");
  });

  it("updates statusFilter from the status select", async () => {
    render(FilterInput);
    const select = screen.getByLabelText("Status");
    await fireEvent.change(select, { target: { value: "failed" } });
    expect(get(statusFilter)).toBe("failed");
  });

  it("lists agents from the runs store and updates agentFilter", async () => {
    render(FilterInput);
    const select = screen.getByLabelText("Agent") as HTMLSelectElement;
    const options = [...select.options].map((o) => o.value);
    expect(options).toContain("all");
    expect(options).toContain("mm-code");
    expect(options).toContain("codex");
    await fireEvent.change(select, { target: { value: "codex" } });
    expect(get(agentFilter)).toBe("codex");
  });
});
