import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { findRowById, headerIndex, loadBoard, resolveBoardFile, saveBoard, toTasks } from "../../src/kanban/board";
import { parseLegend } from "../../src/kanban/legend";
import { FALLBACK_STATUSES } from "../../src/kanban/types";
import { cleanupTmpDirs, HEADER, makeTmpDir, readBoard, row, writeBoard } from "./helpers";

afterEach(cleanupTmpDirs);

function board(rows: string[][] = [row("T1", "Backlog", "one")], legend?: string[]) {
  const dir = makeTmpDir();
  return { dir, file: writeBoard(dir, rows, { legend }) };
}

describe("toTasks", () => {
  it("maps every header to a trimmed string", () => {
    const { file } = board([row("T1", "Backlog", "a title", { priority: "High" })]);
    const tasks = toTasks(loadBoard(file));
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toEqual({
      ID: "T1",
      Status: "Backlog",
      Title: "a title",
      Description: "-",
      Priority: "High",
      Owner: "loop",
      Blocks: "-",
      "Blocked By": "-",
      "Plan File": "-",
    });
  });

  it("returns an empty array for a board with no rows", () => {
    const { file } = board([]);
    expect(toTasks(loadBoard(file))).toEqual([]);
  });
});

describe("findRowById / headerIndex", () => {
  it("findRowById returns the table row index, header being 0", () => {
    const { file } = board([row("T1", "Backlog", "a"), row("T2", "Done", "b")]);
    const doc = loadBoard(file);
    expect(findRowById(doc, "T1")).toBe(1);
    expect(findRowById(doc, "T2")).toBe(2);
  });

  it("findRowById returns -1 for an unknown ID", () => {
    const { file } = board();
    expect(findRowById(loadBoard(file), "T99")).toBe(-1);
  });

  it("headerIndex resolves by name and -1 when absent", () => {
    const { file } = board();
    const doc = loadBoard(file);
    expect(headerIndex(doc, "Status")).toBe(1);
    expect(headerIndex(doc, "Plan File")).toBe(8);
    expect(headerIndex(doc, "Nope")).toBe(-1);
  });
});

describe("parseLegend", () => {
  it("returns the legend statuses in document order, deduplicated", () => {
    const text = [
      "## Status Legend",
      "",
      "| Status | Meaning |",
      "| :-- | :-- |",
      "| `Backlog` | x |",
      "| `In Progress` | y |",
      "| `Backlog` | dup |",
      "| `Done` | z |",
      "",
    ].join("\n");
    expect(parseLegend(text)).toEqual(["Backlog", "In Progress", "Done"]);
  });

  it("returns [] when there is no Status Legend section", () => {
    expect(parseLegend("# Board\n\n## Task Board\n\n| ID | Status |\n| :-- | :-- |\n")).toEqual([]);
  });

  it("stops at the next ## heading and does not swallow Task Board rows", () => {
    const { file } = board([row("T1", "Backlog", "a")]);
    expect(parseLegend(readBoard(file))).toEqual(["Backlog", "In Progress", "Blocked", "Done"]);
  });

  it("picks up a custom status added to the legend", () => {
    const { file } = board([row("T1", "Backlog", "a")], ["Backlog", "Review", "Done"]);
    expect(loadBoard(file).statuses).toEqual(["Backlog", "Review", "Done"]);
  });
});

describe("loadBoard statuses", () => {
  it("falls back to the reference statuses when the board has no legend", () => {
    const dir = makeTmpDir();
    const file = path.join(dir, "docs", "kanban.md");
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, "| ID | Status |\n| :-- | :-- |\n| T1 | Backlog |\n", "utf8");
    expect(loadBoard(file).statuses).toEqual(FALLBACK_STATUSES);
  });
});

describe("saveBoard", () => {
  it("writes markdown that re-parses to the same rows", () => {
    const { file } = board([row("T1", "Backlog", "one"), row("T2", "Done", "two")]);
    const doc = loadBoard(file);
    saveBoard(doc);
    expect(toTasks(loadBoard(file)).map((t) => t.ID)).toEqual(["T1", "T2"]);
  });

  it("re-pads columns without losing cell values", () => {
    const { file } = board([row("T1", "Backlog", "x")]);
    const doc = loadBoard(file);
    saveBoard(doc);
    const text = readBoard(file);
    expect(text).toContain("| T1");
    expect(toTasks(loadBoard(file))[0].Title).toBe("x");
  });
});

describe("resolveBoardFile", () => {
  const ENV = "AT_KANBAN_FILE";
  let saved: string | undefined;

  afterEach(() => {
    if (saved === undefined) delete process.env[ENV];
    else process.env[ENV] = saved;
    saved = undefined;
  });

  it("prefers an explicit path", () => {
    saved = process.env[ENV];
    process.env[ENV] = "/tmp/from-env.md";
    expect(resolveBoardFile("/tmp/explicit.md")).toBe("/tmp/explicit.md");
  });

  it(`uses ${ENV} when no explicit path is given`, () => {
    saved = process.env[ENV];
    process.env[ENV] = "/tmp/from-env.md";
    expect(resolveBoardFile()).toBe("/tmp/from-env.md");
  });

  it("falls back to <project root>/docs/kanban.md", () => {
    saved = process.env[ENV];
    delete process.env[ENV];
    expect(resolveBoardFile()).toBe(path.resolve("docs", "kanban.md"));
  });
});

describe("board headers", () => {
  it("exposes the 9-column contract", () => {
    const { file } = board();
    expect(loadBoard(file).headers).toEqual(HEADER);
    expect(HEADER).toHaveLength(9);
  });
});
