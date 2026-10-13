import { describe, expect, it, vi } from "vitest";
import {
  evaluatePreflight,
  getSafetyLimits,
  nestedRunRefusal,
  type SystemSample,
  startRssWatchdog,
} from "../src/safety";

const limits = getSafetyLimits();
const ok: SystemSample = { runningRuns: 0, availMb: 16000, tempC: 50, load1: 1, cpus: 8 };

describe("evaluatePreflight", () => {
  it("allows a healthy system", () => {
    expect(evaluatePreflight(ok, limits)).toBeNull();
  });
  it("refuses at the concurrency limit", () => {
    expect(evaluatePreflight({ ...ok, runningRuns: limits.maxConcurrent }, limits)).toMatch(/already running/);
  });
  it("refuses on low memory", () => {
    expect(evaluatePreflight({ ...ok, availMb: 500 }, limits)).toMatch(/RAM/);
  });
  it("refuses when hot", () => {
    expect(evaluatePreflight({ ...ok, tempC: 85 }, limits)).toMatch(/hot/);
  });
  it("refuses on high load", () => {
    expect(evaluatePreflight({ ...ok, load1: 40 }, limits)).toMatch(/load/);
  });
});

describe("startRssWatchdog", () => {
  it("kills the process group when RSS exceeds the limit", async () => {
    const kill = vi.spyOn(process, "kill").mockImplementation(() => true);
    const onKill = vi.fn();
    const stop = startRssWatchdog(424242, onKill, { maxRssMb: 100, intervalMs: 10, readRss: () => 500 });
    await new Promise((r) => setTimeout(r, 60));
    stop();
    expect(onKill).toHaveBeenCalledWith(500);
    expect(kill).toHaveBeenCalledWith(-424242, "SIGKILL");
    kill.mockRestore();
  });
  it("leaves a small process alone", async () => {
    const kill = vi.spyOn(process, "kill").mockImplementation(() => true);
    const stop = startRssWatchdog(424242, undefined, { maxRssMb: 100, intervalMs: 10, readRss: () => 5 });
    await new Promise((r) => setTimeout(r, 40));
    stop();
    expect(kill).not.toHaveBeenCalled();
    kill.mockRestore();
  });
});

describe("nestedRunRefusal", () => {
  it("allows depth 0 and refuses depth >= 1", () => {
    expect(nestedRunRefusal(0)).toBeNull();
    expect(nestedRunRefusal(1)).toMatch(/nested delegation/);
  });
  it("can be overridden", () => {
    process.env.AT_ALLOW_NESTED = "1";
    try {
      expect(nestedRunRefusal(2)).toBeNull();
    } finally {
      delete process.env.AT_ALLOW_NESTED;
    }
  });
});
