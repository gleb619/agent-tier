import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CELL_SPLIT_RE, extractIds, ID_RE, lintBoard, ROW_RE, splitCells } from "../../src/kanban/lint";
import { boardMarkdown, cleanupTmpDirs, makeTmpDir, row, VALID_PLAN, writeText } from "./helpers";

afterEach(cleanupTmpDirs);

const LEGEND = [
  "## Status Legend",
  "",
  "| Status | Meaning |",
  "| :-- | :-- |",
  "| `Backlog` | x |",
  "| `In Progress` | x |",
  "| `Blocked` | x |",
  "| `Done` | x |",
].join("\n");

const BOARD_HEADER = [
  "| ID | Status | Title | Description | Priority | Owner | Blocks | Blocked By | Plan File |",
  "| :-- | :-- | :-- | :-- | :-- | :-- | :-- | :-- | :-- |",
].join("\n");

function rawBoard(rows: string[], legend: string = LEGEND): string {
  return `# Kanban Board\n\n${legend}\n\n## Task Board\n\n${BOARD_HEADER}\n${rows.join("\n")}\n`;
}

function lint(rows: string[], opts: { legend?: string; root?: string } = {}) {
  const root = opts.root ?? makeTmpDir();
  return { root, result: lintBoard(rawBoard(rows, opts.legend ?? LEGEND), root) };
}

function goodRow(id: string, status = "Backlog", plan = "-"): string {
  return `| ${id} | ${status} | title | - | Low | loop | - | - | ${plan} |`;
}

describe("splitCells", () => {
  it("splits on unescaped pipes only", () => {
    expect(splitCells("| a | b\\|c | d |")).toEqual(["a", "b\\|c", "d"]);
  });

  it("trims cell padding", () => {
    expect(splitCells("|   a   |  b  |")).toEqual(["a", "b"]);
  });
});

describe("regex vocabulary", () => {
  it("ROW_RE matches only task rows", () => {
    expect(ROW_RE.test("| T12 | Backlog |")).toBe(true);
    expect(ROW_RE.test("| `Backlog` | meaning |")).toBe(false);
    expect(ROW_RE.test("| ID | Status |")).toBe(false);
    expect(ROW_RE.test("| :-- | :-- |")).toBe(false);
    expect(ROW_RE.test("| TASK-1 | Backlog |")).toBe(false);
  });

  it("ID_RE extracts the ID", () => {
    expect(ID_RE.exec("| T7 | Backlog |")?.[1]).toBe("T7");
    expect(ID_RE.exec("| Nope | Backlog |")).toBeNull();
    expect(ID_RE.exec("| `Backlog` | meaning |")).toBeNull();
  });

  it("CELL_SPLIT_RE uses a negative lookbehind", () => {
    expect("a\\|b".split(CELL_SPLIT_RE)).toEqual(["a\\|b"]);
    expect("a|b".split(CELL_SPLIT_RE)).toEqual(["a", "b"]);
  });
});

describe("extractIds", () => {
  it("collects the ID set from arbitrary markdown", () => {
    const text = rawBoard([goodRow("T1"), goodRow("T3"), "| `Backlog` | x |"]);
    expect([...extractIds(text)].sort()).toEqual(["T1", "T3"]);
  });

  it("returns an empty set for text without a board", () => {
    expect(extractIds("# nothing\n\nprose only\n").size).toBe(0);
  });
});

describe("lintBoard — clean boards", () => {
  it("passes a well-formed board and reports the row count", () => {
    const { result } = lint([goodRow("T1"), goodRow("T2", "Done")]);
    expect(result.violations).toEqual([]);
    expect(result.rows).toBe(2);
    expect(result.legend).toEqual(["Backlog", "In Progress", "Blocked", "Done"]);
  });

  it("ignores non-task rows such as legend entries and prose tables", () => {
    const { result } = lint([goodRow("T1")]);
    expect(result.rows).toBe(1);
  });

  it('accepts a "-" or empty Plan File', () => {
    expect(lint([goodRow("T1", "Backlog", "-")]).result.violations).toEqual([]);
    expect(lint([goodRow("T1", "Backlog", "")]).result.violations).toEqual([]);
  });

  it("accepts a plan file that exists", () => {
    const root = makeTmpDir();
    writeText(path.join(root, "docs", "plans", "T1-spec.md"), VALID_PLAN);
    const { result } = lint([goodRow("T1", "Backlog", "./docs/plans/T1-spec.md")], { root });
    expect(result.violations).toEqual([]);
  });

  it("accepts a backtick-wrapped plan path", () => {
    const root = makeTmpDir();
    writeText(path.join(root, "docs", "plans", "T1-spec.md"), VALID_PLAN);
    const { result } = lint([goodRow("T1", "Backlog", "`./docs/plans/T1-spec.md`")], { root });
    expect(result.violations).toEqual([]);
  });
});

describe("lintBoard — violations", () => {
  it("flags a duplicate ID with both line numbers (I1)", () => {
    const { result } = lint([goodRow("T1"), goodRow("T1")]);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0].message).toMatch(/duplicate ID T1 \(first seen at line \d+\)/);
  });

  it("flags an invalid status and lists the expected values sorted (I4)", () => {
    const { result } = lint([goodRow("T1", "Doing")]);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0].message).toBe(
      `line ${result.violations[0].line}: T1 has invalid Status 'Doing' ` +
        "(expected one of: Backlog, Blocked, Done, In Progress)",
    );
  });

  it("flags a column-count mismatch with both counts (I3)", () => {
    const { result } = lint(["| T1 | Backlog | short |"]);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0].message).toMatch(/T1 has 3 columns, header has 9/);
  });

  it("flags a missing plan file with no ID-prefixed fallback", () => {
    const { result } = lint([goodRow("T1", "Backlog", "./docs/plans/T1-nope.md")]);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0].message).toMatch(/T1 Plan File '\.\/docs\/plans\/T1-nope\.md' does not exist/);
  });

  it("flags a missing plan file when only a different ID prefix exists in docs/plans", () => {
    const root = makeTmpDir();
    writeText(path.join(root, "docs", "plans", "T2-other.md"), "# x\n");
    const { result } = lint([goodRow("T1", "Backlog", "./docs/plans/T1-nope.md")], { root });
    expect(result.violations).toHaveLength(1);
  });

  it("reports every violation in one pass instead of failing fast", () => {
    const { result } = lint([goodRow("T1", "Doing"), goodRow("T1"), "| T2 | Backlog | short |"]);
    expect(result.violations.length).toBeGreaterThanOrEqual(3);
  });
});

describe("lintBoard — plan-file fallback (I5)", () => {
  it("accepts a missing plan path when docs/plans/<ID>-* exists", () => {
    const root = makeTmpDir();
    writeText(path.join(root, "docs", "plans", "T2-drifted-slug.md"), VALID_PLAN);
    const { result } = lint([goodRow("T2", "Backlog", "./docs/plans/T2-original.md")], { root });
    expect(result.violations).toEqual([]);
  });

  it("ignores a docs/plans entry that is a directory, not a file", () => {
    const root = makeTmpDir();
    writeText(path.join(root, "docs", "plans", "T2-dir", "nested.md"), "# x\n");
    const { result } = lint([goodRow("T2", "Backlog", "./docs/plans/T2-missing.md")], { root });
    expect(result.violations).toHaveLength(1);
  });
});

describe("lintBoard — escaped pipes (I12)", () => {
  it("does not change the column count when a cell holds an escaped pipe", () => {
    const { result } = lint(["| T1 | Backlog | a \\| b | - | Low | loop | - | - | - |"]);
    expect(result.violations).toEqual([]);
    expect(result.rows).toBe(1);
  });
});

describe("lintBoard — legend handling", () => {
  it("skips the status check when the board has no legend", () => {
    const { result } = lint([goodRow("T1", "Whatever")], { legend: "## Task Board" });
    expect(result.violations).toEqual([]);
  });

  it("accepts a custom status declared in the legend", () => {
    const legend = [
      "## Status Legend",
      "",
      "| Status | Meaning |",
      "| :-- | :-- |",
      "| `Backlog` | x |",
      "| `Review` | x |",
      "| `Done` | x |",
    ].join("\n");
    const { result } = lint([goodRow("T1", "Review")], { legend });
    expect(result.violations).toEqual([]);
    expect(result.legend).toEqual(["Backlog", "Review", "Done"]);
  });
});

describe("lintBoard — the generated fixture", () => {
  it("passes on the helper-generated board markdown", () => {
    const root = makeTmpDir();
    const text = boardMarkdown([row("T1", "Backlog", "a"), row("T2", "Done", "b")]);
    expect(lintBoard(text, root).violations).toEqual([]);
  });
});

describe("lintBoard — stale In Progress guard", () => {
  const DAY_MS = 24 * 60 * 60 * 1000;

  it("does not flag a fresh In Progress plan file", () => {
    const root = makeTmpDir();
    writeText(path.join(root, "docs", "plans", "T1-spec.md"), VALID_PLAN);
    const freshMtime = () => Date.now() - DAY_MS; // 1 day old — under default 7d threshold
    const result = lintBoard(rawBoard([goodRow("T1", "In Progress", "./docs/plans/T1-spec.md")], LEGEND), root, {
      isIgnored: () => false,
      getMtime: freshMtime,
    });
    expect(result.violations).toEqual([]);
  });

  it("flags an In Progress plan file older than staleDays", () => {
    const root = makeTmpDir();
    writeText(path.join(root, "docs", "plans", "T1-spec.md"), VALID_PLAN);
    const staleMtime = () => Date.now() - 10 * DAY_MS; // 10 days — exceeds default 7
    const result = lintBoard(rawBoard([goodRow("T1", "In Progress", "./docs/plans/T1-spec.md")], LEGEND), root, {
      isIgnored: () => false,
      getMtime: staleMtime,
    });
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0].message).toMatch(/stale/);
    expect(result.violations[0].message).toMatch(/In Progress/);
    expect(result.violations[0].message).toMatch(/10 day/);
  });

  it("respects a custom staleDays threshold", () => {
    const root = makeTmpDir();
    writeText(path.join(root, "docs", "plans", "T1-spec.md"), VALID_PLAN);
    const ageMtime = () => Date.now() - 3 * DAY_MS; // 3 days
    // With staleDays=2 this should fire; with staleDays=5 it should not
    const result2 = lintBoard(rawBoard([goodRow("T1", "In Progress", "./docs/plans/T1-spec.md")], LEGEND), root, {
      isIgnored: () => false,
      getMtime: ageMtime,
      staleDays: 2,
    });
    expect(result2.violations.some((v) => v.message.includes("stale"))).toBe(true);

    const result5 = lintBoard(rawBoard([goodRow("T1", "In Progress", "./docs/plans/T1-spec.md")], LEGEND), root, {
      isIgnored: () => false,
      getMtime: ageMtime,
      staleDays: 5,
    });
    expect(result5.violations.filter((v) => v.message.includes("stale"))).toEqual([]);
  });

  it("does not fire for non-In-Progress statuses", () => {
    const root = makeTmpDir();
    writeText(path.join(root, "docs", "plans", "T1-spec.md"), VALID_PLAN);
    const staleMtime = () => Date.now() - 30 * DAY_MS; // very old
    for (const status of ["Backlog", "Blocked", "Done"]) {
      const result = lintBoard(rawBoard([goodRow("T1", status, "./docs/plans/T1-spec.md")], LEGEND), root, {
        isIgnored: () => false,
        getMtime: staleMtime,
      });
      expect(result.violations.filter((v) => v.message.includes("stale"))).toEqual([]);
    }
  });

  it("disables the guard when staleDays is 0", () => {
    const root = makeTmpDir();
    writeText(path.join(root, "docs", "plans", "T1-spec.md"), VALID_PLAN);
    const staleMtime = () => Date.now() - 30 * DAY_MS;
    const result = lintBoard(rawBoard([goodRow("T1", "In Progress", "./docs/plans/T1-spec.md")], LEGEND), root, {
      isIgnored: () => false,
      getMtime: staleMtime,
      staleDays: 0,
    });
    expect(result.violations.filter((v) => v.message.includes("stale"))).toEqual([]);
  });

  it("disables the guard when staleDays is Infinity", () => {
    const root = makeTmpDir();
    writeText(path.join(root, "docs", "plans", "T1-spec.md"), VALID_PLAN);
    const staleMtime = () => Date.now() - 365 * DAY_MS;
    const result = lintBoard(rawBoard([goodRow("T1", "In Progress", "./docs/plans/T1-spec.md")], LEGEND), root, {
      isIgnored: () => false,
      getMtime: staleMtime,
      staleDays: Number.POSITIVE_INFINITY,
    });
    expect(result.violations.filter((v) => v.message.includes("stale"))).toEqual([]);
  });

  it("does not crash when getMtime returns null (file stat error)", () => {
    const root = makeTmpDir();
    writeText(path.join(root, "docs", "plans", "T1-spec.md"), VALID_PLAN);
    const result = lintBoard(rawBoard([goodRow("T1", "In Progress", "./docs/plans/T1-spec.md")], LEGEND), root, {
      isIgnored: () => false,
      getMtime: () => null,
    });
    // null mtime → skip stale check, no crash
    expect(result.violations.filter((v) => v.message.includes("stale"))).toEqual([]);
  });
});

describe("lintBoard — gitignored plan files", () => {
  // Stub helpers: always-ignored and never-ignored
  const alwaysIgnored = () => true;
  const neverIgnored = () => false;

  it("does not flag a missing plan file when the path is gitignored", () => {
    const root = makeTmpDir();
    // File does not exist, but our stub says it is ignored → no violation
    const result = lintBoard(rawBoard([goodRow("T1", "Backlog", "./docs/plans/T1-spec.md")], LEGEND), root, {
      isIgnored: alwaysIgnored,
    });
    expect(result.violations).toEqual([]);
  });

  it("flags a missing plan file when the path is NOT gitignored", () => {
    const root = makeTmpDir();
    const result = lintBoard(rawBoard([goodRow("T1", "Backlog", "./docs/plans/T1-spec.md")], LEGEND), root, {
      isIgnored: neverIgnored,
    });
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0].message).toMatch(/T1 Plan File.*does not exist/);
  });

  it("does not call isIgnored when the plan file exists on disk", () => {
    const root = makeTmpDir();
    writeText(path.join(root, "docs", "plans", "T1-spec.md"), VALID_PLAN);
    let called = false;
    lintBoard(rawBoard([goodRow("T1", "Backlog", "./docs/plans/T1-spec.md")], LEGEND), root, {
      isIgnored: () => {
        called = true;
        return false;
      },
    });
    expect(called).toBe(false);
  });

  it("treats a git error (isIgnored throws) as not-ignored and flags the missing file", () => {
    const root = makeTmpDir();
    const throwingIgnored = (): boolean => {
      throw new Error("git not found");
    };
    const result = lintBoard(rawBoard([goodRow("T1", "Backlog", "./docs/plans/T1-spec.md")], LEGEND), root, {
      isIgnored: throwingIgnored,
    });
    expect(result.violations).toHaveLength(1);
  });
});
