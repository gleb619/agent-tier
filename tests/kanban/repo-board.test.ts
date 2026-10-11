import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadBoard, toTasks } from "../../src/kanban/board";
import { lintBoard } from "../../src/kanban/lint";
import { COLUMNS, ID_PATTERN, numericId, SENTINEL } from "../../src/kanban/types";

const ROOT = path.resolve(__dirname, "..", "..");
const BOARD = path.join(ROOT, "docs", "kanban.md");

describe("the repo board (docs/kanban.md)", () => {
  it("passes the structural lint with zero violations", () => {
    const result = lintBoard(readFileSync(BOARD, "utf8"), ROOT);
    expect(result.violations).toEqual([]);
    expect(result.rows).toBeGreaterThan(0);
  });

  it("declares the reference status legend", () => {
    expect(loadBoard(BOARD).statuses).toEqual(["Backlog", "In Progress", "Blocked", "Done"]);
  });

  it("uses the 9-column schema", () => {
    expect(loadBoard(BOARD).headers).toEqual([...COLUMNS]);
  });

  it("gives every row a T<integer> ID (I2)", () => {
    for (const task of toTasks(loadBoard(BOARD))) {
      expect(task.ID).toMatch(ID_PATTERN);
    }
  });

  it("keeps rows sorted ascending by numeric ID (I6)", () => {
    const ids = toTasks(loadBoard(BOARD)).map((t) => numericId(t.ID));
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
  });

  it('uses the "-" sentinel rather than empty optional cells', () => {
    for (const task of toTasks(loadBoard(BOARD))) {
      for (const column of ["Blocks", "Blocked By", "Plan File"]) {
        expect(task[column], `${task.ID} ${column}`).not.toBe("");
        if (task[column] === SENTINEL) continue;
        expect(task[column].length).toBeGreaterThan(0);
      }
    }
  });

  it("keeps every description within the 128-character cap (I9)", () => {
    for (const task of toTasks(loadBoard(BOARD))) {
      expect([...task.Description].length).toBeLessThanOrEqual(128);
    }
  });

  it("has at most one In Progress task (I7)", () => {
    const running = toTasks(loadBoard(BOARD)).filter((t) => t.Status === "In Progress");
    expect(running.length).toBeLessThanOrEqual(1);
  });
});
