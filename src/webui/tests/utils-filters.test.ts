import { describe, expect, it } from "vitest";
import type { ApiRun } from "../types/api";
import { matchesQuery } from "../utils/filters";

function run(partial: Partial<ApiRun>): Pick<ApiRun, "name" | "prompt" | "runId"> {
  return { runId: "abc123", name: "Fix login bug", prompt: "fix the login bug in auth", ...partial };
}

describe("matchesQuery", () => {
  it("matches everything for empty/whitespace query", () => {
    expect(matchesQuery(run({}), "")).toBe(true);
    expect(matchesQuery(run({}), "   ")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(matchesQuery(run({}), "FIX")).toBe(true);
    expect(matchesQuery(run({}), "Login")).toBe(true);
    expect(matchesQuery(run({}), "LOGIN BUG")).toBe(true);
  });

  it("matches on name, prompt and runId", () => {
    expect(matchesQuery(run({ name: "unique-name" }), "unique-name")).toBe(true);
    expect(matchesQuery(run({}), "auth")).toBe(true);
    expect(matchesQuery(run({}), "abc123")).toBe(true);
  });

  it("requires every token (multi-token AND)", () => {
    expect(matchesQuery(run({}), "fix bug")).toBe(true);
    expect(matchesQuery(run({}), "bug fix")).toBe(true);
    expect(matchesQuery(run({}), "fix missing")).toBe(false);
  });

  it("tokens may come from different fields", () => {
    expect(matchesQuery(run({}), "login abc123")).toBe(true);
  });

  it("returns false when any token is missing", () => {
    expect(matchesQuery(run({}), "zzz")).toBe(false);
    expect(matchesQuery(run({}), "fix zzz")).toBe(false);
  });
});
