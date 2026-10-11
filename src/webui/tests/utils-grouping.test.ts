import { describe, expect, it } from "vitest";
import type { ApiRun } from "../types/api";
import { groupRunsByDate } from "../utils/grouping";

const NOW = new Date(2026, 9, 11, 15, 0, 0); // local 2026-10-11 15:00

function run(id: string, startedAt: Date): ApiRun {
  return {
    runId: id,
    agent: "mm-code",
    tier: 2,
    pid: 1,
    prompt: "p",
    logFile: `/tmp/${id}.log`,
    startedAt: startedAt.toISOString(),
    finishedAt: null,
    exitCode: null,
    status: "done",
    name: id,
  };
}

describe("groupRunsByDate", () => {
  it("labels today and yesterday groups", () => {
    const groups = groupRunsByDate([run("a", new Date(NOW)), run("b", new Date(NOW.getTime() - 86400000))], NOW);
    expect(groups.map((g) => g.label)).toEqual(["Today", "Yesterday"]);
  });

  it("labels older runs with month + day (year only when it differs)", () => {
    const groups = groupRunsByDate([run("a", new Date(2026, 9, 9, 8, 0)), run("b", new Date(2025, 11, 31, 8, 0))], NOW);
    expect(groups.map((g) => g.label)).toEqual(["Oct 9", "Dec 31, 2025"]);
  });

  it("orders groups newest day first, runs newest first within a day", () => {
    const groups = groupRunsByDate(
      [
        run("old", new Date(2026, 9, 9, 8, 0)),
        run("later-today", new Date(2026, 9, 11, 14, 0)),
        run("earlier-today", new Date(2026, 9, 11, 9, 0)),
      ],
      NOW,
    );
    expect(groups.map((g) => g.label)).toEqual(["Today", "Oct 9"]);
    expect(groups[0]?.runs.map((r) => r.runId)).toEqual(["later-today", "earlier-today"]);
  });

  it("keeps input order (assumed newest first) within a group without re-sorting", () => {
    const groups = groupRunsByDate(
      [run("a", new Date(2026, 9, 11, 9, 0)), run("b", new Date(2026, 9, 11, 14, 0))],
      NOW,
    );
    expect(groups[0]?.runs.map((r) => r.runId)).toEqual(["a", "b"]);
  });

  it("returns empty array for empty list", () => {
    expect(groupRunsByDate([], NOW)).toEqual([]);
  });

  it("exposes a stable local-date key per group", () => {
    const groups = groupRunsByDate([run("a", new Date(2026, 9, 11, 9, 0))], NOW);
    expect(groups[0]?.key).toBe("2026-10-11");
  });
});
