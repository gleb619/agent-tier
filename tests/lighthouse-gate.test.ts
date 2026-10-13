import { describe, expect, it } from "vitest";
import { evaluateGate, formatGateResult, type LhrLike } from "../scripts/lighthouse-gate";

function lhr(overrides: {
  categories?: Record<string, number | null>;
  audits?: Record<string, number | null>;
}): LhrLike {
  const categories: LhrLike["categories"] = {};
  for (const [id, score] of Object.entries(overrides.categories ?? {})) categories[id] = { score };
  const audits: LhrLike["audits"] = {};
  for (const [id, score] of Object.entries(overrides.audits ?? {})) audits[id] = { score };
  return { categories, audits };
}

describe("lighthouse gate", () => {
  it("passes when all categories and audits meet their minimums", () => {
    const result = evaluateGate(
      lhr({ categories: { performance: 0.97 }, audits: { "installable-manifest": 1, "service-worker": 1 } }),
      { categories: { performance: 0.9 }, audits: { "installable-manifest": 1, "service-worker": 1 } },
    );
    expect(result.ok).toBe(true);
    expect(result.failures).toEqual([]);
    expect(result.checks).toHaveLength(3);
  });

  it("fails when a category score is below the threshold", () => {
    const result = evaluateGate(lhr({ categories: { performance: 0.7 } }), { categories: { performance: 0.9 } });
    expect(result.ok).toBe(false);
    expect(result.failures[0]).toMatch(/performance.*0\.70 < 0\.90/);
  });

  it("fails when a binary audit does not pass", () => {
    const result = evaluateGate(lhr({ audits: { "installable-manifest": 0 } }), {
      audits: { "installable-manifest": 1 },
    });
    expect(result.ok).toBe(false);
    expect(result.failures[0]).toContain("installable-manifest");
  });

  it("fails with a clear message when a requested id is missing from the report", () => {
    const result = evaluateGate(lhr({}), {
      categories: { pwa: 1 },
      audits: { "installable-manifest": 1 },
    });
    expect(result.ok).toBe(false);
    expect(result.failures).toHaveLength(2);
    expect(result.failures.join("\n")).toContain('category "pwa": missing');
    expect(result.failures.join("\n")).toContain('audit "installable-manifest": missing');
  });

  it("treats null scores as missing", () => {
    const result = evaluateGate(lhr({ categories: { performance: null } }), { categories: { performance: 0.9 } });
    expect(result.ok).toBe(false);
    expect(result.failures[0]).toContain("missing");
  });

  it("formatGateResult lists checks and failures", () => {
    const result = evaluateGate(lhr({ categories: { performance: 0.5 } }), { categories: { performance: 0.9 } });
    const text = formatGateResult(result);
    expect(text).toContain("performance");
    expect(text).toContain("failures:");
  });
});
