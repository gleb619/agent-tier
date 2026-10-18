import { describe, expect, it } from "vitest";
import { checkKeywordsQuality, checkPlanStructure } from "../../src/kanban/plan-lint";

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

describe("checkPlanStructure — Steps vs Done-when ratio guard", () => {
  /** Build a plan with N checkbox steps and M done-when bullets. */
  function planWith(steps: number, criteria: number): string {
    const stepLines = Array.from({ length: steps }, (_, i) => `- [ ] step ${i + 1}`).join("\n");
    const criteriaLines = Array.from({ length: criteria }, (_, i) => `- criterion ${i + 1}`).join("\n");
    return `# T1 — test

## Goal

goal text here

## Keywords

Keywords: src/foo.ts

## Time

Planned: ${steps * 3}m

## Steps

${stepLines}

## Done when

${criteriaLines}
`;
  }

  it("passes when steps and criteria are balanced (3:1 ratio exactly)", () => {
    // 3 steps, 1 criterion → exactly at limit, no warning
    expect(checkPlanStructure(planWith(3, 1), "In Progress")).toEqual([]);
  });

  it("passes when steps are fewer than criteria", () => {
    expect(checkPlanStructure(planWith(2, 3), "In Progress")).toEqual([]);
  });

  it("warns when steps exceed criteria by more than 3:1", () => {
    // 4 steps, 1 criterion → 4 > 1*3 → warns
    const out = checkPlanStructure(planWith(4, 1), "In Progress").join("\n");
    expect(out).toMatch(/Steps \(4\).*Done when.*\(1\)/);
    expect(out).toMatch(/acceptance criteria/);
  });

  it("warns at a larger ratio too (many steps, few criteria)", () => {
    const out = checkPlanStructure(planWith(10, 2), "In Progress").join("\n");
    expect(out).toMatch(/Steps \(10\).*Done when.*\(2\)/);
  });

  it("does not fire when Done when is missing (that error is separate)", () => {
    // Steps but no Done when section at all — only the 'missing section' error fires
    const t = planWith(10, 1).replace(/## Done when[\s\S]*$/, "");
    const out = checkPlanStructure(t, "In Progress").join("\n");
    expect(out).not.toMatch(/far exceeds/);
  });

  it("is exempt for Backlog", () => {
    // Backlog only checks presence, not ratio
    expect(checkPlanStructure(planWith(10, 1), "Backlog")).toEqual([]);
  });
});

describe("checkKeywordsQuality", () => {
  it("returns null for a keyword with a file path (contains /)", () => {
    expect(checkKeywordsQuality(["Keywords: src/runner.ts, auth"])).toBeNull();
  });

  it("returns null for a keyword with a dot extension", () => {
    expect(checkKeywordsQuality(["Keywords: runner.ts"])).toBeNull();
  });

  it("returns null for a camelCase keyword", () => {
    expect(checkKeywordsQuality(["Keywords: schedulerNext"])).toBeNull();
  });

  it("returns null for a snake_case keyword", () => {
    expect(checkKeywordsQuality(["Keywords: run_store"])).toBeNull();
  });

  it("returns null for an ALL_CAPS identifier", () => {
    expect(checkKeywordsQuality(["Keywords: AT_STATE_DIR"])).toBeNull();
  });

  it("returns a warning when all keywords are plain prose words", () => {
    const warn = checkKeywordsQuality(["Keywords: authentication, performance, refactor"]);
    expect(warn).not.toBeNull();
    expect(warn!).toMatch(/file paths or symbol names/);
    expect(warn!).toMatch(/codegraph/);
  });

  it("returns null for empty body (separate guard handles that)", () => {
    expect(checkKeywordsQuality([])).toBeNull();
  });

  it("passes when any single keyword is a symbol/path", () => {
    // One concrete reference saves the whole section
    expect(checkKeywordsQuality(["Keywords: performance, src/runner.ts"])).toBeNull();
  });
});

describe("checkPlanStructure — Keywords quality guard integration", () => {
  it("warns when Keywords has only prose words in In Progress", () => {
    const t = good.replace("Keywords: auth, src/a.ts", "Keywords: authentication, performance");
    const out = checkPlanStructure(t, "In Progress").join("\n");
    expect(out).toMatch(/file paths or symbol names/);
  });

  it("passes when at least one keyword is a path", () => {
    const t = good.replace("Keywords: auth, src/a.ts", "Keywords: authentication, src/auth.ts");
    expect(checkPlanStructure(t, "In Progress")).toEqual([]);
  });

  it("does not fire the quality guard for Backlog (section presence only)", () => {
    // Backlog is not strict — quality guard only runs in strict mode
    const t = good.replace("Keywords: auth, src/a.ts", "Keywords: authentication");
    expect(checkPlanStructure(t, "Backlog")).toEqual([]);
  });
});
