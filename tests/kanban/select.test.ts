import { describe, expect, it } from "vitest";
import { isUnblocked, nextExecutable } from "../../src/kanban/select";
import type { Task } from "../../src/kanban/types";

function t(id: string, status: string, priority = "Low", blockedBy = "-"): Task {
  return {
    ID: id,
    Status: status,
    Title: id,
    Description: "-",
    Priority: priority,
    Owner: "loop",
    Blocks: "-",
    "Blocked By": blockedBy,
    "Plan File": "-",
  };
}

describe("isUnblocked", () => {
  it('treats a blank or "-" Blocked By as unblocked', () => {
    expect(isUnblocked(t("T1", "Backlog", "Low", "-"), [t("T1", "Backlog")])).toBe(true);
    expect(isUnblocked(t("T1", "Backlog", "Low", ""), [t("T1", "Backlog")])).toBe(true);
  });

  it("is unblocked when every listed blocker is Done", () => {
    const all = [t("T1", "Done"), t("T2", "Done"), t("T3", "Backlog", "Low", "T1,T2")];
    expect(isUnblocked(all[2], all)).toBe(true);
  });

  it.each(["Backlog", "In Progress", "Blocked"])("is blocked when a known blocker is %s", (status) => {
    const all = [t("T1", status), t("T2", "Backlog", "Low", "T1")];
    expect(isUnblocked(all[1], all)).toBe(false);
  });

  it("ignores unknown blocker IDs (permissive)", () => {
    const all = [t("T2", "Backlog", "Low", "T999")];
    expect(isUnblocked(all[0], all)).toBe(true);
  });

  it("splits on commas and whitespace", () => {
    const all = [t("T1", "Done"), t("T2", "Backlog"), t("T3", "Backlog", "Low", "T1 T2")];
    expect(isUnblocked(all[2], all)).toBe(false);
  });

  it("is blocked when only one of several blockers is unfinished", () => {
    const all = [t("T1", "Done"), t("T2", "Backlog"), t("T3", "Backlog", "Low", "T1,T2")];
    expect(isUnblocked(all[2], all)).toBe(false);
  });
});

describe("nextExecutable", () => {
  it("Rule 1: an In Progress task wins over a higher-priority Backlog task", () => {
    const tasks = [t("T1", "Backlog", "High"), t("T2", "In Progress", "Low")];
    const selection = nextExecutable(tasks);
    expect(selection).toEqual({ type: "current", task: tasks[1] });
  });

  it("Rule 1: returns the first In Progress row when several exist", () => {
    const tasks = [t("T1", "In Progress"), t("T2", "In Progress")];
    expect(nextExecutable(tasks)?.task.ID).toBe("T1");
  });

  it("Rule 2: returns null on an empty board", () => {
    expect(nextExecutable([])).toBeNull();
  });

  it("Rule 2: returns null when every row is Done", () => {
    expect(nextExecutable([t("T1", "Done"), t("T2", "Done")])).toBeNull();
  });

  it("Rule 2: returns null when every Backlog row is blocked", () => {
    const tasks = [t("T1", "Backlog", "High", "T2"), t("T2", "Backlog", "High", "T1")];
    expect(nextExecutable(tasks)).toBeNull();
  });

  it("never selects a Blocked row (I8)", () => {
    const tasks = [t("T1", "Blocked", "High"), t("T2", "Backlog", "Low")];
    expect(nextExecutable(tasks)?.task.ID).toBe("T2");
  });

  it("never selects a Blocked row even when all of its blockers are Done", () => {
    const tasks = [t("T1", "Done"), t("T2", "Blocked", "High", "T1"), t("T3", "Backlog", "Low")];
    const selection = nextExecutable(tasks);
    expect(selection).toEqual({ type: "next", task: tasks[2] });
  });

  it("Rule 3: High beats Medium beats Low", () => {
    const tasks = [t("T1", "Backlog", "Low"), t("T2", "Backlog", "Medium"), t("T3", "Backlog", "High")];
    expect(nextExecutable(tasks)?.task.ID).toBe("T3");
  });

  it("Rule 3: an unknown priority sorts last", () => {
    const tasks = [t("T1", "Backlog", "Urgent"), t("T2", "Backlog", "Low")];
    expect(nextExecutable(tasks)?.task.ID).toBe("T2");
  });

  it("Rule 3: ties break on the lowest numeric ID, not lexicographic (T9 before T10)", () => {
    const tasks = [t("T10", "Backlog", "Low"), t("T9", "Backlog", "Low")];
    expect(nextExecutable(tasks)?.task.ID).toBe("T9");
  });

  it("skips a High task blocked by a live Backlog task and picks the unblocked Low one", () => {
    const tasks = [t("T1", "Done"), t("T2", "Backlog", "High", "T3"), t("T3", "Backlog", "Low")];
    expect(nextExecutable(tasks)?.task.ID).toBe("T3");
  });

  it("prefers an unblocked task whose blocker is Done", () => {
    const tasks = [t("T1", "Done"), t("T2", "Backlog", "High", "T1")];
    expect(nextExecutable(tasks)).toEqual({ type: "next", task: tasks[1] });
  });

  it("is deterministic — same input yields the same result", () => {
    const tasks = [t("T1", "Backlog", "Medium"), t("T2", "Backlog", "High"), t("T3", "Backlog", "High")];
    expect(nextExecutable([...tasks])?.task.ID).toBe(nextExecutable([...tasks])?.task.ID);
    expect(nextExecutable([...tasks])?.task.ID).toBe("T2");
  });

  it("does not mutate the input array", () => {
    const tasks = [t("T2", "Backlog", "Low"), t("T1", "Backlog", "High")];
    const snapshot = tasks.map((x) => x.ID);
    nextExecutable(tasks);
    expect(tasks.map((x) => x.ID)).toEqual(snapshot);
  });
});
