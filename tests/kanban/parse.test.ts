import { describe, expect, it } from "vitest";
import { cellText, makeCell, parseBoardText, setCellText, stringifyBoard } from "../../src/kanban/parse";
import { boardMarkdown, HEADER, row } from "./helpers";

describe("cellText", () => {
  it("extracts plain text and trims padding", () => {
    expect(cellText(makeCell("  padded  "))).toBe("padded");
  });

  it("keeps a raw pipe in the value — remark escapes it on write, not us", () => {
    expect(cellText(makeCell("a|b"))).toBe("a|b");
  });

  it("extracts inline code values", () => {
    const text = [
      "| ID | Status | Plan File |",
      "| :-- | :-- | :-- |",
      "| T1 | Backlog | `./docs/plans/T1-x.md` |",
      "",
    ].join("\n");
    const parsed = parseBoardText(text);
    const planCell = parsed.table.children[1].children[2];
    expect(cellText(planCell)).toBe("./docs/plans/T1-x.md");
  });
});

describe("setCellText", () => {
  it("replaces children with a single text node holding the raw value", () => {
    const cell = makeCell("old");
    setCellText(cell, "new|value");
    expect(cell.children).toHaveLength(1);
    expect(cellText(cell)).toBe("new|value");
  });
});

describe("parseBoardText", () => {
  it("finds the table with ID + Status headers and ignores the Status Legend table", () => {
    const parsed = parseBoardText(boardMarkdown([row("T1", "Backlog", "one")]));
    expect(parsed.headers).toEqual(HEADER);
    expect(parsed.table.children).toHaveLength(2);
  });

  it("discovers column order from the header, not from position", () => {
    const reordered = [
      "# Board",
      "",
      "| Status | ID | Title |",
      "| :-- | :-- | :-- |",
      "| Backlog | T7 | reordered |",
      "",
    ].join("\n");
    const parsed = parseBoardText(reordered);
    expect(parsed.headers).toEqual(["Status", "ID", "Title"]);
  });

  it("throws when no board table exists", () => {
    expect(() => parseBoardText("# Nothing here\n\njust prose\n")).toThrow(
      "No kanban task table found (expected ID + Status columns)",
    );
  });

  it("throws when a table has ID but no Status column", () => {
    const text = "| ID | Name |\n| :-- | :-- |\n| T1 | x |\n";
    expect(() => parseBoardText(text)).toThrow(/No kanban task table found/);
  });

  it("round-trips: stringify then re-parse yields the same rows", () => {
    const rows = [row("T1", "Backlog", "one"), row("T2", "Done", "two")];
    const parsed = parseBoardText(boardMarkdown(rows));
    const text = stringifyBoard(parsed.processor, parsed.tree);
    const again = parseBoardText(text);
    expect(again.headers).toEqual(parsed.headers);
    expect(again.table.children).toHaveLength(parsed.table.children.length);
  });
});
