import { statSync } from "fs";
import { afterEach, describe, expect, it } from "vitest";
import { loadBoard, mutateBoard, toTasks } from "../../src/kanban/board";
import { opAdd } from "../../src/kanban/ops";
import { cleanupTmpDirs, makeTmpDir, row, writeBoard } from "./helpers";

afterEach(cleanupTmpDirs);

describe("mutateBoard", () => {
  it("runs fn against a freshly loaded board and saves when the op changed it", async () => {
    const file = writeBoard(makeTmpDir(), [row("T1", "Backlog", "one")]);
    const r = await mutateBoard(file, (doc) => opAdd(doc, { id: "T2", title: "two" }));
    expect(r.changed).toBe(true);
    expect(toTasks(loadBoard(file)).map((t) => t.ID)).toEqual(["T1", "T2"]);
  });

  it("returns the fn result untouched", async () => {
    const file = writeBoard(makeTmpDir(), [row("T1", "Backlog", "one")]);
    const r = await mutateBoard(file, (doc) => opAdd(doc, { id: "T2", title: "two" }));
    expect(r.messages).toEqual(["Added T2: two"]);
    expect(r.warnings).toEqual([]);
    expect((r.data as { id: string }).id).toBe("T2");
  });

  it("does not write the board when the op did not change anything", async () => {
    const file = writeBoard(makeTmpDir(), [row("T1", "Backlog", "one")]);
    const before = statSync(file).mtimeMs;
    await new Promise((resolve) => setTimeout(resolve, 10));
    await mutateBoard(file, () => ({ messages: [], warnings: [], changed: false }));
    expect(statSync(file).mtimeMs).toBe(before);
  });

  it("releases the lock when fn throws, so a later mutation still works", async () => {
    const file = writeBoard(makeTmpDir(), [row("T1", "Backlog", "one")]);
    await expect(
      mutateBoard(file, () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    const r = await mutateBoard(file, (doc) => opAdd(doc, { id: "T2", title: "two" }));
    expect(r.changed).toBe(true);
    expect(toTasks(loadBoard(file)).map((t) => t.ID)).toEqual(["T1", "T2"]);
  });

  it("two concurrent mutateBoard calls adding different tasks both survive", async () => {
    const file = writeBoard(makeTmpDir(), [row("T1", "Backlog", "seed")]);
    await Promise.all([
      mutateBoard(file, (doc) => opAdd(doc, { id: "T2", title: "alpha" })),
      mutateBoard(file, (doc) => opAdd(doc, { id: "T3", title: "beta" })),
    ]);
    const tasks = toTasks(loadBoard(file));
    expect(tasks.map((t) => t.ID)).toEqual(["T1", "T2", "T3"]);
    expect(tasks.map((t) => t.Title)).toEqual(["seed", "alpha", "beta"]);
  });

  it("10 concurrent adds all survive with unique IDs", async () => {
    const file = writeBoard(makeTmpDir(), []);
    await Promise.all(
      Array.from({ length: 10 }, (_, i) => mutateBoard(file, (doc) => opAdd(doc, { title: `task ${i}` }))),
    );
    const tasks = toTasks(loadBoard(file));
    expect(tasks).toHaveLength(10);
    const ids = tasks.map((t) => t.ID);
    expect(new Set(ids).size).toBe(10);
    // Rows are kept in numeric ID order by opAdd.
    expect(ids).toEqual(ids.map((_, i) => `T${i + 1}`));
  });
});
