import { describe, expect, it } from "vitest";
import type { ApiStats } from "../types/api";
import { deriveDashboardStats } from "../utils/dashboard";

function makeStats(partial: Partial<ApiStats> = {}): ApiStats {
  return {
    total: 0,
    running: 0,
    done: 0,
    failed: 0,
    stuck: 0,
    agents: { total: 0, deactivated: 0 },
    ...partial,
  };
}

describe("deriveDashboardStats", () => {
  it("maps every ApiStats field to a labeled tile", () => {
    const items = deriveDashboardStats(makeStats({ total: 10, running: 2, done: 6, failed: 2, stuck: 1 }));
    const byLabel = new Map(items.map((i) => [i.label, i.value]));
    expect(byLabel.get("Total runs")).toBe("10");
    expect(byLabel.get("Running")).toBe("2");
    expect(byLabel.get("Done")).toBe("6");
    expect(byLabel.get("Failed")).toBe("2");
    expect(byLabel.get("Stuck")).toBe("1");
  });

  it("derives the success rate from done vs failed", () => {
    const items = deriveDashboardStats(makeStats({ done: 3, failed: 1 }));
    expect(items.find((i) => i.label === "Success rate")?.value).toBe("75%");
  });

  it("shows an em dash when no run finished yet", () => {
    const items = deriveDashboardStats(makeStats({ done: 0, failed: 0 }));
    expect(items.find((i) => i.label === "Success rate")?.value).toBe("—");
  });

  it("reports agents as active/total", () => {
    const items = deriveDashboardStats(makeStats({ agents: { total: 14, deactivated: 2 } }));
    expect(items.find((i) => i.label === "Agents")?.value).toBe("12/14");
  });

  it("flags non-zero failed and stuck counts with danger/warning tones", () => {
    const items = deriveDashboardStats(makeStats({ done: 1, failed: 2, stuck: 1 }));
    expect(items.find((i) => i.label === "Failed")?.tone).toBe("danger");
    expect(items.find((i) => i.label === "Stuck")?.tone).toBe("warning");
    expect(items.find((i) => i.label === "Done")?.tone).toBe("success");
  });
});
