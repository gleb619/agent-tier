import { describe, it, expect } from 'vitest';
import { UNNAMED_PLACEHOLDER, type RunRecord } from '../../src/run-store';
import { groupRunsByDate } from '../../src/tui2/components/Sidebar';
import {
  buildRowModel,
  isSelectable,
  moveSelection,
  selectableRowIndices,
  type Row,
} from '../../src/tui2/components/sidebar/row-model';

const NOW = new Date();

/** A timestamp pinned to today's date so day buckets never depend on run time. */
const at = (hour: number, minute = 0): string =>
  new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate(), hour, minute, 0).toISOString();

const mockRun = (runId: string, overrides: Partial<RunRecord> = {}): RunRecord => ({
  runId,
  agent: 'mm-code',
  tier: 2,
  pid: 1234,
  prompt: 'do the thing',
  logFile: `/tmp/${runId}.log`,
  startedAt: at(11),
  finishedAt: null,
  exitCode: null,
  status: 'running',
  name: UNNAMED_PLACEHOLDER,
  ...overrides,
});

describe('tui2 sidebar row model', () => {
  describe('buildRowModel', () => {
    it('places filter, a separator, the four menu rows, and a second separator in that order', () => {
      const rows = buildRowModel({ groups: [], filter: '', activeView: 'dashboard' });
      // filter + sep + 4 menu + sep
      expect(rows.map((r) => r.kind)).toEqual([
        'filter',
        'separator',
        'menu',
        'menu',
        'menu',
        'menu',
        'separator',
      ]);
    });

    it('marks the active menu row', () => {
      const rows = buildRowModel({ groups: [], filter: '', activeView: 'run-details' });
      // Indices shifted by one (separator now sits before the menu block):
      //   0 filter, 1 sep, 2..5 menu, 6 sep
      expect(rows[4]).toMatchObject({ kind: 'menu', view: 'run-details', active: true });
      expect((rows[2] as { active: boolean }).active).toBe(false);
    });

    it('exposes the current filter text on the filter row', () => {
      const rows = buildRowModel({ groups: [], filter: 'glm', activeView: 'dashboard' });
      expect(rows[0]).toMatchObject({ kind: 'filter', filter: 'glm' });
    });

    it('appends group headers and their runs below the second separator', () => {
      const runs = [mockRun('r1', { startedAt: at(10) }), mockRun('r2', { startedAt: at(11) })];
      const groups = groupRunsByDate(runs);
      const rows = buildRowModel({ groups, filter: '', activeView: 'dashboard' });

      // filter + sep + 4 menu + sep + (group-header + run + run)
      expect(rows.map((r) => r.kind)).toEqual([
        'filter',
        'separator',
        'menu',
        'menu',
        'menu',
        'menu',
        'separator',
        'group-header',
        'run',
        'run',
      ]);
      expect(rows[7]).toMatchObject({ kind: 'group-header', label: 'Today' });
      expect((rows[8] as { runId: string }).runId).toBe('r1');
      expect((rows[9] as { runId: string }).runId).toBe('r2');
    });

    it('keeps the placeholder "no runs" case compact', () => {
      const rows = buildRowModel({ groups: [], filter: 'nope', activeView: 'dashboard' });
      // filter + sep + 4 menu + sep = 7 rows
      expect(rows).toHaveLength(7);
    });
  });

  describe('selectableRowIndices', () => {
    it('skips separators and group headers', () => {
      const runs = [mockRun('r1', { startedAt: at(10) }), mockRun('r2', { startedAt: at(11) })];
      const rows = buildRowModel({
        groups: groupRunsByDate(runs),
        filter: '',
        activeView: 'dashboard',
      });
      // 0..9; selectable = 0, 2, 3, 4, 5, 8, 9 (skip separators at 1, 6 and header at 7)
      expect(selectableRowIndices(rows)).toEqual([0, 2, 3, 4, 5, 8, 9]);
    });

    it('is empty when only the filter row exists (no menu, no runs)', () => {
      // Hypothetical: filters only, no menu — isSelectable on filter still true.
      const rows: Row[] = [{ kind: 'filter', label: 'Filter runs…', filter: '' }];
      expect(selectableRowIndices(rows)).toEqual([0]);
    });

    it('isSelectable matches filter/menu/run kinds only', () => {
      const runs = [mockRun('r1', { startedAt: at(10) })];
      const rows = buildRowModel({
        groups: groupRunsByDate(runs),
        filter: '',
        activeView: 'dashboard',
      });
      for (const [i, row] of rows.entries()) {
        if (row.kind === 'filter' || row.kind === 'menu' || row.kind === 'run') {
          expect(isSelectable(row)).toBe(true);
        } else {
          expect(isSelectable(row)).toBe(false);
        }
        expect(typeof i).toBe('number');
      }
    });
  });

  describe('moveSelection', () => {
    const runs = [mockRun('r1', { startedAt: at(10) }), mockRun('r2', { startedAt: at(11) })];
    const rows = buildRowModel({
      groups: groupRunsByDate(runs),
      filter: '',
      activeView: 'dashboard',
    });

    it('starts the user on the first selectable row when current is -1', () => {
      expect(moveSelection(rows, -1, 1)).toBe(0); // filter row
      expect(moveSelection(rows, -1, -1)).toBe(9); // last selectable (second run)
    });

    it('moves down through selectable rows and skips separators/headers', () => {
      expect(moveSelection(rows, 0, 1)).toBe(2); // filter → first menu (skip sep at 1)
      expect(moveSelection(rows, 5, 1)).toBe(8); // last menu → first run (skip sep + header)
      expect(moveSelection(rows, 8, 1)).toBe(9); // run → run
    });

    it('moves up through selectable rows and skips separators/headers', () => {
      expect(moveSelection(rows, 8, -1)).toBe(5); // first run → last menu (skip header + sep)
      expect(moveSelection(rows, 2, -1)).toBe(0); // first menu → filter (skip sep)
      expect(moveSelection(rows, 9, -1)).toBe(8); // last run → prev run
    });

    it('clamps at the ends of the selectable subset', () => {
      expect(moveSelection(rows, 9, 1)).toBe(9); // last → last
      expect(moveSelection(rows, 0, -1)).toBe(0); // first → first
    });

    it('snaps an off-list current to the nearest selectable row', () => {
      // Current points at the first separator (row 1) or the second separator (row 6)
      // or the group header (row 7); delta doesn't matter — snap to first.
      expect(moveSelection(rows, 1, 1)).toBe(0);
      expect(moveSelection(rows, 6, -1)).toBe(0);
      expect(moveSelection(rows, 7, 1)).toBe(0);
    });

    it('returns -1 only when there are no selectable rows', () => {
      const empty: Row[] = [
        { kind: 'separator' },
        { kind: 'group-header', label: 'Today' },
      ];
      expect(moveSelection(empty, -1, 1)).toBe(-1);
    });
  });
});
