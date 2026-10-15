import { describe, expect, it } from "vitest";
import { type RunRecord, UNNAMED_PLACEHOLDER } from "../../src/run-store";
import { groupRunsByDate } from "../../src/tui/components/Sidebar";
import {
  buildRowModel,
  isSelectable,
  moveSelection,
  preserveSidebarIndex,
  type Row,
  selectableRowIndices,
} from "../../src/tui/components/sidebar/row-model";

const NOW = new Date();

/** A timestamp pinned to today's date so day buckets never depend on run time. */
const at = (hour: number, minute = 0): string =>
  new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate(), hour, minute, 0).toISOString();

const YEARS_AGO = new Date(NOW.getTime() - 400 * 24 * 60 * 60 * 1000).toISOString();

const mockRun = (runId: string, overrides: Partial<RunRecord> = {}): RunRecord => ({
  runId,
  agent: "mm-code",
  tier: 2,
  pid: 1234,
  prompt: "do the thing",
  logFile: `/tmp/${runId}.log`,
  startedAt: at(11),
  finishedAt: null,
  exitCode: null,
  status: "running",
  name: UNNAMED_PLACEHOLDER,
  ...overrides,
});

describe("sidebar row model", () => {
  describe("buildRowModel", () => {
    it("places filter, a separator, the five menu rows, and a second separator in that order", () => {
      const rows = buildRowModel({ groups: [], filter: "", activeView: "dashboard" });
      // filter + sep + 5 menu + sep
      expect(rows.map((r) => r.kind)).toEqual([
        "filter",
        "separator",
        "menu",
        "menu",
        "menu",
        "menu",
        "menu",
        "separator",
      ]);
    });

    it("marks the active menu row", () => {
      const rows = buildRowModel({ groups: [], filter: "", activeView: "run-details" });
      // Indices shifted by one (separator now sits before the menu block):
      //   0 filter, 1 sep, 2..6 menu, 7 sep
      //   dashboard=2, new-task=3, run-details=4, agents=5, settings=6
      expect(rows[4]).toMatchObject({ kind: "menu", view: "run-details", active: true });
      expect((rows[2] as { active: boolean }).active).toBe(false);
    });

    it("exposes the current filter text on the filter row", () => {
      const rows = buildRowModel({ groups: [], filter: "glm", activeView: "dashboard" });
      expect(rows[0]).toMatchObject({ kind: "filter", filter: "glm" });
    });

    it("appends group headers and their runs below the second separator", () => {
      const runs = [mockRun("r1", { startedAt: at(10) }), mockRun("r2", { startedAt: at(11) })];
      const groups = groupRunsByDate(runs);
      const rows = buildRowModel({ groups, filter: "", activeView: "dashboard" });

      // filter + sep + 5 menu + sep + (group-header + run + run)
      expect(rows.map((r) => r.kind)).toEqual([
        "filter",
        "separator",
        "menu",
        "menu",
        "menu",
        "menu",
        "menu",
        "separator",
        "group-header",
        "run",
        "run",
      ]);
      expect(rows[8]).toMatchObject({ kind: "group-header", label: "Today" });
      expect((rows[9] as { runId: string }).runId).toBe("r1");
      expect((rows[10] as { runId: string }).runId).toBe("r2");
    });

    it('keeps the placeholder "no runs" case compact', () => {
      // 'nope' matches no menu keyword and no label, and no runs exist — so
      // the row model collapses to filter + the two separators framing the
      // (empty) menu block. Compact: just the input box visible.
      const rows = buildRowModel({ groups: [], filter: "nope", activeView: "dashboard" });
      // filter + sep + sep = 3 rows
      expect(rows).toHaveLength(3);
      expect(rows.map((r) => r.kind)).toEqual(["filter", "separator", "separator"]);
    });
  });

  describe("selectableRowIndices", () => {
    it("skips separators and group headers", () => {
      const runs = [mockRun("r1", { startedAt: at(10) }), mockRun("r2", { startedAt: at(11) })];
      const rows = buildRowModel({
        groups: groupRunsByDate(runs),
        filter: "",
        activeView: "dashboard",
      });
      // 5-menu layout: 0 filter, 1 sep, 2..6 menu, 7 sep, 8 header, 9 run r1, 10 run r2
      expect(selectableRowIndices(rows)).toEqual([0, 2, 3, 4, 5, 6, 9, 10]);
    });

    it("is empty when only the filter row exists (no menu, no runs)", () => {
      // Hypothetical: filters only, no menu — isSelectable on filter still true.
      const rows: Row[] = [{ kind: "filter", label: "Filter runs…", filter: "" }];
      expect(selectableRowIndices(rows)).toEqual([0]);
    });

    it("isSelectable matches filter/menu/run kinds only", () => {
      const runs = [mockRun("r1", { startedAt: at(10) })];
      const rows = buildRowModel({
        groups: groupRunsByDate(runs),
        filter: "",
        activeView: "dashboard",
      });
      for (const [i, row] of rows.entries()) {
        if (row.kind === "filter" || row.kind === "menu" || row.kind === "run") {
          expect(isSelectable(row)).toBe(true);
        } else {
          expect(isSelectable(row)).toBe(false);
        }
        expect(typeof i).toBe("number");
      }
    });
  });

  describe("moveSelection", () => {
    const runs = [mockRun("r1", { startedAt: at(10) }), mockRun("r2", { startedAt: at(11) })];
    const rows = buildRowModel({
      groups: groupRunsByDate(runs),
      filter: "",
      activeView: "dashboard",
    });

    it("starts the user on the first selectable row when current is -1", () => {
      expect(moveSelection(rows, -1, 1)).toBe(0); // filter row
      expect(moveSelection(rows, -1, -1)).toBe(10); // last selectable (second run)
    });

    it("moves down through selectable rows and skips separators/headers", () => {
      expect(moveSelection(rows, 0, 1)).toBe(2); // filter → first menu (skip sep at 1)
      expect(moveSelection(rows, 6, 1)).toBe(9); // last menu → first run (skip sep 7 + header 8)
      expect(moveSelection(rows, 9, 1)).toBe(10); // run → run
    });

    it("moves up through selectable rows and skips separators/headers", () => {
      expect(moveSelection(rows, 9, -1)).toBe(6); // first run → last menu (skip header 8 + sep 7)
      expect(moveSelection(rows, 2, -1)).toBe(0); // first menu → filter (skip sep 1)
      expect(moveSelection(rows, 10, -1)).toBe(9); // last run → prev run
    });

    it("clamps at the ends of the selectable subset", () => {
      expect(moveSelection(rows, 10, 1)).toBe(10); // last → last
      expect(moveSelection(rows, 0, -1)).toBe(0); // first → first
    });

    it("snaps an off-list current to the nearest selectable row", () => {
      // Current points at a separator or the group header; delta doesn't
      // matter — snap to first.
      expect(moveSelection(rows, 1, 1)).toBe(0);
      expect(moveSelection(rows, 7, -1)).toBe(0);
      expect(moveSelection(rows, 8, 1)).toBe(0);
    });

    it("returns -1 only when there are no selectable rows", () => {
      const empty: Row[] = [{ kind: "separator" }, { kind: "group-header", label: "Today" }];
      expect(moveSelection(empty, -1, 1)).toBe(-1);
    });
  });

  describe("preserveSidebarIndex", () => {
    /** rows: 0 filter, 1 sep, 2..6 menu, 7 sep, 8 header, 9 run r1, 10 run r2. */
    const rowsFor = (runs: RunRecord[]): Row[] =>
      buildRowModel({
        groups: groupRunsByDate(runs),
        filter: "",
        activeView: "dashboard",
      });

    const r1 = mockRun("r1", { startedAt: at(10) });
    const r2 = mockRun("r2", { startedAt: at(11) });
    const base = rowsFor([r1, r2]);
    const runRowIndex = (rows: Row[], runId: string): number =>
      rows.findIndex((r) => r.kind === "run" && r.runId === runId);

    it("returns the same index for an unchanged list (no-op rebuild)", () => {
      // A poll that reads back identical data must not move the cursor — this
      // is what keeps the Sidebar effect silent between ticks.
      expect(preserveSidebarIndex(base, 2, base)).toBe(2);
      expect(preserveSidebarIndex(base, 9, base)).toBe(9);
      expect(preserveSidebarIndex(base, 10, base)).toBe(10);
    });

    it("follows a run row when a newer run is prepended above it", () => {
      const withNew = rowsFor([mockRun("r0", { startedAt: at(12) }), r1, r2]);
      expect(preserveSidebarIndex(base, 9, withNew)).toBe(runRowIndex(withNew, "r1"));
      expect(preserveSidebarIndex(base, 10, withNew)).toBe(runRowIndex(withNew, "r2"));
    });

    it("follows a run row when the rows shift by a new group header", () => {
      const withOtherDay = rowsFor([mockRun("r0", { startedAt: YEARS_AGO }), r1, r2]);
      const next = preserveSidebarIndex(base, 10, withOtherDay);
      expect(next).toBe(runRowIndex(withOtherDay, "r2"));
    });

    it("keeps the cursor on filter and menu rows while they stay selectable", () => {
      const withNew = rowsFor([mockRun("r0", { startedAt: at(12) }), r1, r2]);
      expect(preserveSidebarIndex(base, 0, withNew)).toBe(0); // filter
      expect(preserveSidebarIndex(base, 3, withNew)).toBe(3); // menu row
    });

    it("falls back to the first selectable row when the run vanished", () => {
      const withoutR2 = rowsFor([r1]);
      expect(preserveSidebarIndex(base, 10, withoutR2)).toBe(selectableRowIndices(withoutR2)[0]);
    });

    it("falls back to the first selectable row when a menu row is filtered out", () => {
      // 5-menu layout: filter "retries" hides everything except Settings (index 6).
      const filtered = buildRowModel({
        groups: groupRunsByDate([r1, r2]),
        filter: "retries",
        activeView: "dashboard",
      });
      expect(preserveSidebarIndex(base, 3, filtered)).toBe(selectableRowIndices(filtered)[0]);
    });

    it("lands a -1 cursor on the first selectable row once one exists", () => {
      expect(preserveSidebarIndex(base, -1, base)).toBe(0);
      const empty: Row[] = [{ kind: "separator" }, { kind: "group-header", label: "Today" }];
      expect(preserveSidebarIndex(empty, -1, empty)).toBe(-1);
    });

    it("returns -1 when nothing is selectable", () => {
      const empty: Row[] = [{ kind: "separator" }];
      expect(preserveSidebarIndex(base, 9, empty)).toBe(-1);
    });
  });

  describe("menu filter", () => {
    /** Collect just the menu rows, in display order. */
    const menuRows = (rows: Row[]) => rows.filter((r): r is Extract<Row, { kind: "menu" }> => r.kind === "menu");

    it("keeps all five menu rows when the filter is empty", () => {
      const rows = buildRowModel({ groups: [], filter: "", activeView: "dashboard" });
      expect(menuRows(rows).map((m) => m.view)).toEqual(["dashboard", "new-task", "run-details", "agents", "settings"]);
    });

    it("keeps all five menu rows when the filter is whitespace only", () => {
      const rows = buildRowModel({ groups: [], filter: "   \t ", activeView: "dashboard" });
      expect(menuRows(rows).map((m) => m.view)).toEqual(["dashboard", "new-task", "run-details", "agents", "settings"]);
    });

    it("matches a substring of a menu label (case-insensitive)", () => {
      const rows = buildRowModel({ groups: [], filter: "dash", activeView: "settings" });
      const menus = menuRows(rows);
      expect(menus.map((m) => m.view)).toEqual(["dashboard"]);
      // Filter row always first so the input stays visible.
      expect(rows[0].kind).toBe("filter");
      // Separator around the (possibly empty) menu block still in place.
      expect(rows[1].kind).toBe("separator");
    });

    it("matches a keyword/alias per view (retries → Settings)", () => {
      const rows = buildRowModel({ groups: [], filter: "retries", activeView: "dashboard" });
      expect(menuRows(rows).map((m) => m.view)).toEqual(["settings"]);
    });

    it("matches keywords for semantic queries (tier → Agents or Settings)", () => {
      // "tier" is shared by both Agents and Settings keywords (NAV_KEYWORDS).
      const rows = buildRowModel({ groups: [], filter: "tier", activeView: "dashboard" });
      expect(
        menuRows(rows)
          .map((m) => m.view)
          .sort(),
      ).toEqual(["agents", "settings"]);
    });

    it("multi-token query: every token must match somewhere (label or keywords)", () => {
      // "new task" → label of New Task matches as one substring; also each
      // token individually matches ("new" in label, "task" in label).
      const rows = buildRowModel({ groups: [], filter: "new task", activeView: "dashboard" });
      expect(menuRows(rows).map((m) => m.view)).toEqual(["new-task"]);
    });

    it("multi-token query that splits cleanly across keyword sets returns no menu rows", () => {
      // "dash retries": "dash" matches Dashboard, "retries" matches Settings —
      // AND across tokens leaves neither view matching both.
      const rows = buildRowModel({ groups: [], filter: "dash retries", activeView: "dashboard" });
      expect(menuRows(rows)).toEqual([]);
    });

    it("emits zero menu rows when nothing matches, but the filter row is still first", () => {
      const rows = buildRowModel({ groups: [], filter: "zzzz", activeView: "dashboard" });
      expect(rows[0].kind).toBe("filter");
      expect(menuRows(rows)).toEqual([]);
      // selectable indices are still valid — j/k navigation snaps to filter.
      const sel = selectableRowIndices(rows);
      expect(sel).toContain(0);
      expect(moveSelection(rows, -1, 1)).toBe(0);
    });

    it("keeps the active marker correct after filtering (▶ on Settings only)", () => {
      const rows = buildRowModel({ groups: [], filter: "retries", activeView: "settings" });
      const menus = menuRows(rows);
      expect(menus).toHaveLength(1);
      expect(menus[0]).toMatchObject({ kind: "menu", view: "settings", active: true });
    });

    it("drops the active marker when the active view itself is filtered out", () => {
      // Filter excludes the active view — no menu row, so no row carries `active`.
      const rows = buildRowModel({ groups: [], filter: "retries", activeView: "dashboard" });
      for (const row of rows) {
        if (row.kind === "menu") expect(row.active).toBe(false);
      }
    });

    it("does not touch the run list — buildRowModel renders the groups it was given", () => {
      // Run-list filtering happens upstream (filteredSessions2 → groupRunsByDate).
      // This row model trusts the pre-filtered groups; the menu filter only
      // changes which menu rows appear, not which runs are rendered.
      const runs = [
        mockRun("r1", { agent: "glm-code", prompt: "fix bug" }),
        mockRun("r2", { agent: "mm-code", prompt: "add feature" }),
      ];
      const rows = buildRowModel({
        groups: groupRunsByDate(runs),
        filter: "mm-code",
        activeView: "dashboard",
      });
      const runRows = rows.filter((r) => r.kind === "run");
      expect(runRows.map((r) => (r as { runId: string }).runId)).toEqual(["r1", "r2"]);
      // The filter string lands on the filter row only.
      expect(rows[0]).toMatchObject({ kind: "filter", filter: "mm-code" });
    });
  });
});
