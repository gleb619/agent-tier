import { describe, expect, it } from "vitest";
import { navMatchesQuery, runMatchesQuery } from "../../ui-spec";
import type { ApiRun } from "../types/api";

function run(partial: Partial<ApiRun>): Pick<ApiRun, "runId" | "name" | "agent" | "prompt"> {
  return { runId: "abc123", name: "Fix login bug", agent: "mm-code", prompt: "fix the login bug in auth", ...partial };
}

describe("runMatchesQuery", () => {
  it("matches everything for empty/whitespace query", () => {
    expect(runMatchesQuery(run({}), "")).toBe(true);
    expect(runMatchesQuery(run({}), "   ")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(runMatchesQuery(run({}), "FIX")).toBe(true);
    expect(runMatchesQuery(run({}), "Login")).toBe(true);
    expect(runMatchesQuery(run({}), "LOGIN BUG")).toBe(true);
  });

  it("matches on name, prompt, runId and agent", () => {
    expect(runMatchesQuery(run({ name: "unique-name" }), "unique-name")).toBe(true);
    expect(runMatchesQuery(run({}), "auth")).toBe(true);
    expect(runMatchesQuery(run({}), "abc123")).toBe(true);
    expect(runMatchesQuery(run({ agent: "codex" }), "codex")).toBe(true);
  });

  it("requires every token (multi-token AND)", () => {
    expect(runMatchesQuery(run({}), "fix bug")).toBe(true);
    expect(runMatchesQuery(run({}), "bug fix")).toBe(true);
    expect(runMatchesQuery(run({}), "fix missing")).toBe(false);
  });

  it("tokens may come from different fields", () => {
    expect(runMatchesQuery(run({}), "login abc123")).toBe(true);
  });

  it("returns false when any token is missing", () => {
    expect(runMatchesQuery(run({}), "zzz")).toBe(false);
    expect(runMatchesQuery(run({}), "fix zzz")).toBe(false);
  });
});

describe("navMatchesQuery", () => {
  it("matches when query is empty", () => {
    expect(navMatchesQuery("dashboard", "Dashboard", "")).toBe(true);
    expect(navMatchesQuery("settings", "Settings", "   ")).toBe(true);
  });

  it("matches against the label", () => {
    expect(navMatchesQuery("dashboard", "Dashboard", "dash")).toBe(true);
    expect(navMatchesQuery("settings", "Settings", "sett")).toBe(true);
  });

  it("matches against the per-view keyword aliases", () => {
    // settings has `NAV_KEYWORDS` covering config/setting/line/tier/etc.
    expect(navMatchesQuery("settings", "Settings", "line")).toBe(true);
    // new-task keywords include "prompt"
    expect(navMatchesQuery("new-task", "New Task", "prompt")).toBe(true);
    // run-details keywords include "log"
    expect(navMatchesQuery("run-details", "Run Details", "log")).toBe(true);
  });

  it("hides items whose label and keywords miss every token", () => {
    expect(navMatchesQuery("dashboard", "Dashboard", "xyz-no-match")).toBe(false);
    expect(navMatchesQuery("settings", "Settings", "agents unknown")).toBe(false);
  });

  it("requires every token (multi-token AND)", () => {
    expect(navMatchesQuery("new-task", "New Task", "new prompt")).toBe(true);
    expect(navMatchesQuery("new-task", "New Task", "new zzz")).toBe(false);
  });
});
