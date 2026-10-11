import { describe, expect, it } from "vitest";
import type { ApiRun } from "../types/api";
import { formatDuration, runDurationSeconds } from "../utils/formatters";

describe("formatDuration", () => {
  it("formats seconds only", () => {
    expect(formatDuration(0)).toBe("0s");
    expect(formatDuration(12)).toBe("12s");
    expect(formatDuration(59)).toBe("59s");
  });

  it("formats minutes and seconds", () => {
    expect(formatDuration(60)).toBe("1m 00s");
    expect(formatDuration(83)).toBe("1m 23s");
    expect(formatDuration(3599)).toBe("59m 59s");
  });

  it("formats hours and minutes (seconds dropped)", () => {
    expect(formatDuration(3600)).toBe("1h 00m");
    expect(formatDuration(45296)).toBe("12h 34m");
  });

  it("floors partial seconds and rejects negatives", () => {
    expect(formatDuration(12.9)).toBe("12s");
    expect(formatDuration(-5)).toBe("—");
  });
});

describe("runDurationSeconds", () => {
  const start = "2026-10-11T10:00:00.000Z";

  it("uses finishedAt when present", () => {
    const r = { startedAt: start, finishedAt: "2026-10-11T10:01:30.000Z" } as Pick<ApiRun, "startedAt" | "finishedAt">;
    expect(runDurationSeconds(r, /* now */ new Date("2026-10-11T11:00:00.000Z"))).toBe(90);
  });

  it("falls back to now for unfinished runs", () => {
    const r = { startedAt: start, finishedAt: null } as Pick<ApiRun, "startedAt" | "finishedAt">;
    expect(runDurationSeconds(r, new Date("2026-10-11T10:00:45.000Z"))).toBe(45);
  });

  it("never goes negative when finishedAt precedes startedAt", () => {
    const r = { startedAt: start, finishedAt: "2026-10-11T09:59:00.000Z" } as Pick<ApiRun, "startedAt" | "finishedAt">;
    expect(runDurationSeconds(r, new Date("2026-10-11T11:00:00.000Z"))).toBe(0);
  });
});
