import { describe, expect, it } from "vitest";
import { applyNormkaFlag, shouldPassNormkaFlag } from "../../src/agents/normka-flag";
import type { AgentDef } from "../../src/agents/registry";

function mkAgent(tier: 1 | 2 | 3 | 4): AgentDef {
  return { name: "x", tier, bin: () => "/bin/true", buildArgs: () => ["echo"] };
}

describe("shouldPassNormkaFlag", () => {
  it("true when prompt starts with #NORMKA", () => {
    expect(shouldPassNormkaFlag("#NORMKA\n\n{}")).toBe(true);
  });
  it("true on case-insensitive #normka", () => {
    expect(shouldPassNormkaFlag("#normka\n{}")).toBe(true);
  });
  it("true when prompt contains fenced normka:on block", () => {
    expect(shouldPassNormkaFlag("```json\n// normka:on\n{}\n```")).toBe(true);
  });
  it("false otherwise", () => {
    expect(shouldPassNormkaFlag("hello world")).toBe(false);
  });
});

describe("applyNormkaFlag", () => {
  it("appends --normka for tier-4 when caller opts in", () => {
    const agent = mkAgent(4);
    const out = applyNormkaFlag(agent, ["echo", "hi"], "hi", { normka: true });
    expect(out).toEqual(["echo", "hi", "--normka"]);
  });
  it("appends --normka for tier-4 when prompt triggers normka", () => {
    const agent = mkAgent(4);
    const out = applyNormkaFlag(agent, ["echo"], "#NORMKA\n{}");
    expect(out).toContain("--normka");
  });
  it("does NOT append for tier 1", () => {
    const agent = mkAgent(1);
    const out = applyNormkaFlag(agent, ["echo"], "#NORMKA\n{}", { normka: true });
    expect(out).not.toContain("--normka");
  });
  it("does NOT append when neither opt nor trigger", () => {
    const agent = mkAgent(4);
    const out = applyNormkaFlag(agent, ["echo"], "hello");
    expect(out).toEqual(["echo"]);
  });
});
