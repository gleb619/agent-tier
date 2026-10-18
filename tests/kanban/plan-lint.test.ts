import { describe, expect, it } from "vitest";
import { checkPlanStructure } from "../../src/kanban/plan-lint";

const good = `# T1 — x

## Goal

Ship it.

## Keywords

Keywords: auth, src/a.ts

## Time

Planned: 30m
Estimated: -

## Steps

- [ ] write test
- [ ] implement

## Done when

- tests pass
`;

describe("checkPlanStructure", () => {
  it("accepts a complete plan in every enforced status", () => {
    for (const s of ["Backlog", "In Progress", "Blocked"]) expect(checkPlanStructure(good, s)).toEqual([]);
  });
  it("Backlog needs headings only; a skeleton passes until work starts", () => {
    const sk = "## Goal\n<x>\n## Steps\n- [ ] <y>\n## Done when\n- <z>\n## Time\n";
    expect(checkPlanStructure(sk, "Backlog")).toEqual([]);
    expect(checkPlanStructure(sk, "In Progress").length).toBeGreaterThanOrEqual(3);
  });
  it("exempts Done", () => {
    expect(checkPlanStructure("# legacy\n", "Done")).toEqual([]);
  });
  it("reports each missing required section", () => {
    const out = checkPlanStructure("# T\n", "Backlog").join("\n");
    for (const h of ["Goal", "Steps", "Done when"]) expect(out).toContain(`'${h}'`);
    expect(out).not.toContain("'Time'"); // Time is owned by checkPlanTime
  });
  it("treats placeholders and comments as empty", () => {
    const t = good.replace("Ship it.", "<what and why>\n<!-- todo -->");
    expect(checkPlanStructure(t, "In Progress")[0]).toMatch(/'Goal'.*empty/);
  });
  it("accepts other heading levels and a trailing colon", () => {
    expect(checkPlanStructure(good.replace("## Goal", "### Goal:"), "Backlog")).toEqual([]);
  });
  it("ignores headings inside code fences", () => {
    const t = good.replace("## Goal\n\nShip it.\n", "```\n## Goal\n```\n");
    expect(checkPlanStructure(t, "Backlog").join()).toMatch(/'Goal'/);
  });
  it("requires Steps to be checkboxes with text", () => {
    expect(checkPlanStructure(good.replace("- [ ] write test", "- write test"), "In Progress").join()).toMatch(
      /Steps.*checkbox/,
    );
    expect(checkPlanStructure(good.replace("- [ ] write test", "- [ ] 1."), "In Progress").join()).toMatch(
      /Steps.*empty step/,
    );
  });
  it("requires a Done when bullet", () => {
    expect(checkPlanStructure(good.replace("- tests pass", "tests pass"), "In Progress").join()).toMatch(
      /'Done when'.*bullet/,
    );
  });
  it("requires non-empty Keywords once started only", () => {
    const t = good.replace("Keywords: auth, src/a.ts", "<symbols>");
    expect(checkPlanStructure(t, "Backlog")).toEqual([]);
    expect(checkPlanStructure(t, "In Progress").join()).toMatch(/Keywords/);
  });
  it("cross-checks Planned against step count (2m per step)", () => {
    expect(checkPlanStructure(good.replace("Planned: 30m", "Planned: 3m"), "In Progress").join()).toMatch(
      /Planned 3m.*2 steps/,
    );
    expect(checkPlanStructure(good.replace("Planned: 30m", "Planned: 4m"), "In Progress")).toEqual([]);
  });
});
