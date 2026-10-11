import { describe, expect, it } from "vitest";
import { allDone, parseChecklist, parseVerdict, pendingItems, setChecked } from "../../src/compose/md-state";

const SAMPLE = `# Tasks

- [ ] 1. Create domain types
- [x] 2. Add tests
- [ ] 3. Wire routing
`;

describe("parseChecklist", () => {
  it("returns all checkbox items with checked state", () => {
    const items = parseChecklist(SAMPLE);
    expect(items).toHaveLength(3);
    expect(items[0].checked).toBe(false);
    expect(items[1].checked).toBe(true);
    expect(items[2].checked).toBe(false);
  });

  it("ignores plain list items without a checkbox", () => {
    expect(parseChecklist("- no box here\n- [ ] 1. boxed\n")).toHaveLength(1);
  });
});

describe("setChecked", () => {
  it("marks item at index as checked", () => {
    const updated = setChecked(SAMPLE, 0, true);
    const items = parseChecklist(updated);
    expect(items[0].checked).toBe(true);
    expect(items[2].checked).toBe(false);
  });
  it("marks item as unchecked", () => {
    const updated = setChecked(SAMPLE, 1, false);
    expect(parseChecklist(updated)[1].checked).toBe(false);
  });
});

describe("allDone", () => {
  it("returns true when all checked", () => {
    expect(allDone("- [x] 1. A\n- [x] 2. B\n")).toBe(true);
  });
  it("returns false when any unchecked", () => {
    expect(allDone(SAMPLE)).toBe(false);
  });
  it("returns false when there are no items", () => {
    expect(allDone("# nothing here\n")).toBe(false);
  });
});

describe("pendingItems", () => {
  it("returns only unchecked items", () => {
    const items = pendingItems(SAMPLE);
    expect(items).toHaveLength(2);
    expect(items.map((i) => i.index)).toEqual([0, 2]);
  });
});

describe("parseVerdict", () => {
  it("reads PASS from the first line", () => {
    expect(parseVerdict("PASS\n\nAll tasks ticked, tests green.\n")).toBe("PASS");
  });

  it("reads FAIL from the first line", () => {
    expect(parseVerdict("FAIL\n\n- missing validation in src/x.ts:12\n")).toBe("FAIL");
  });

  it("skips leading blank lines and heading markers", () => {
    expect(parseVerdict("\n\n# PASS\n")).toBe("PASS");
  });

  it("accepts a trailing explanation on the verdict line", () => {
    expect(parseVerdict("PASS - all acceptance criteria met\n")).toBe("PASS");
  });

  it("is case insensitive", () => {
    expect(parseVerdict("pass\n")).toBe("PASS");
  });

  it("treats unparsable content as FAIL", () => {
    expect(parseVerdict("looks good to me\n")).toBe("FAIL");
    expect(parseVerdict("MAYBE\n")).toBe("FAIL");
  });

  it("treats empty markdown as FAIL", () => {
    expect(parseVerdict("")).toBe("FAIL");
    expect(parseVerdict("\n\n  \n")).toBe("FAIL");
  });

  it("only looks at the first non-empty line", () => {
    expect(parseVerdict("Summary of the review.\nPASS\n")).toBe("FAIL");
  });
});
