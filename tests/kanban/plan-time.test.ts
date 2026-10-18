import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { lintBoard } from "../../src/kanban/lint";
import { planSkeleton } from "../../src/kanban/plan";
import { checkPlanTime, findPlanFile, parsePlanTime, setPlanTimeField } from "../../src/kanban/plan-time";
import { cleanupTmpDirs, makeTmpDir } from "./helpers";

afterEach(cleanupTmpDirs);

describe("parsePlanTime", () => {
  it("reads Planned/Estimated from the Time section", () => {
    const t = parsePlanTime("# T\n\n## Time\n\nPlanned: 45m\nEstimated: `52m`\n\n## Design\nPlanned: 9h\n");
    expect(t).toEqual({ hasSection: true, planned: "45m", estimated: "52m" });
  });

  it("treats '-', blanks and <placeholders> as unset; no section is reported", () => {
    expect(parsePlanTime("## Time\nPlanned: <e.g. 45m>\nEstimated: -\n")).toEqual({
      hasSection: true,
      planned: null,
      estimated: null,
    });
    expect(parsePlanTime("# T\nPlanned: 5m\n").hasSection).toBe(false);
  });

  it("the skeleton has an unfilled Time section", () => {
    const t = parsePlanTime(planSkeleton({ id: "T1", title: "x", keywords: [] }));
    expect(t).toEqual({ hasSection: true, planned: null, estimated: null });
  });
});

describe("setPlanTimeField", () => {
  it("replaces an existing field only inside the Time section", () => {
    const out = setPlanTimeField(
      "## Time\n\nPlanned: 1h\nEstimated: -\n\n## Design\nEstimated: keep\n",
      "Estimated",
      "70m",
    );
    expect(parsePlanTime(out)).toMatchObject({ planned: "1h", estimated: "70m" });
    expect(out).toContain("Estimated: keep");
  });

  it("adds a missing field, and creates the section when absent", () => {
    expect(parsePlanTime(setPlanTimeField("## Time\n\nPlanned: 1h\n", "Estimated", "2h")).estimated).toBe("2h");
    const created = setPlanTimeField("# T\n\nbody\n", "Estimated", "2h");
    expect(parsePlanTime(created)).toMatchObject({ hasSection: true, estimated: "2h" });
    expect(created).toContain("body");
  });
});

describe("checkPlanTime", () => {
  const ok = "## Time\nPlanned: 30m\n";
  it("Backlog needs the section but not a value", () => {
    expect(checkPlanTime("## Time\n", "Backlog")).toEqual([]);
    expect(checkPlanTime("# T\n", "Backlog")[0]).toMatch(/missing/);
  });
  it("started tasks need a valid Planned", () => {
    expect(checkPlanTime("## Time\n", "In Progress")[0]).toMatch(/no 'Planned'/);
    expect(checkPlanTime("## Time\nPlanned: soon\n", "In Progress")[0]).toMatch(/not a duration/);
    expect(checkPlanTime(ok, "In Progress")).toEqual([]);
  });
  it("Estimated, when set, must be a duration; Done is exempt", () => {
    expect(checkPlanTime(`${ok}Estimated: lots\n`, "Blocked")[0]).toMatch(/Estimated/);
    expect(checkPlanTime("# legacy\n", "Done")).toEqual([]);
  });
});

describe("lintBoard enforces plan Time sections", () => {
  function setup(plan: string | null, status: string, ignored = false) {
    const root = makeTmpDir();
    mkdirSync(path.join(root, "docs", "plans"), { recursive: true });
    if (plan !== null) writeFileSync(path.join(root, "docs", "plans", "T1-x.md"), plan);
    const board = [
      "## Status Legend",
      "",
      "| Status | M | W |",
      "| :-- | :-- | :-- |",
      "| `Backlog` | a | b |",
      "| `In Progress` | a | b |",
      "| `Done` | a | b |",
      "",
      "| ID | Status | Title | Plan File |",
      "| :-- | :-- | :-- | :-- |",
      `| T1 | ${status} | x | plans/T1-x.md |`,
      "",
    ].join("\n");
    return lintBoard(board, root, { boardDir: path.join(root, "docs"), isIgnored: () => ignored });
  }

  it("flags a plan with no Time section / no Planned on a started task", () => {
    expect(setup("# T1\n", "Backlog").violations[0]?.message).toMatch(/missing '## Time'/);
    expect(setup("## Time\n", "In Progress").violations[0]?.message).toMatch(/no 'Planned'/);
  });
  it("passes valid plans, Done legacy plans and absent plan files", () => {
    expect(setup("## Time\nPlanned: 20m\n", "In Progress").violations).toEqual([]);
    expect(setup("# legacy\n", "Done").violations).toEqual([]);
    expect(setup(null, "Backlog", true).violations).toEqual([]);
  });
});

describe("findPlanFile", () => {
  it("resolves against board dir, then root, then <ID>-* in docs/plans", () => {
    const root = makeTmpDir();
    mkdirSync(path.join(root, "docs", "plans"), { recursive: true });
    const f = path.join(root, "docs", "plans", "T2-real.md");
    writeFileSync(f, "x");
    expect(findPlanFile("plans/T2-real.md", "T2", root, path.join(root, "docs"))).toBe(f);
    expect(findPlanFile("docs/plans/T2-real.md", "T2", root)).toBe(f);
    expect(findPlanFile("plans/drifted.md", "T2", root, path.join(root, "docs"))).toBe(f);
    expect(findPlanFile("-", "T2", root)).toBeNull();
    expect(readFileSync(f, "utf8")).toBe("x");
  });
});
