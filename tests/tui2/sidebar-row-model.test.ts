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
    it('places filter, the four menu rows, and a separator in that order', () => {
      const rows = buildRowModel({ groups: [], filter: '', activeView: 'dashboard' });
      expect(rows.map((r) => r.kind)).toEqual(['filter', 'menu', 'menu', 'menu', 'menu', 'separator']);
    });

    it('marks the active menu row', () => {
      const rows = buildRowModel({ groups: [], filter: '', activeView: 'run-details' });
      expect(rows[3]).toMatchObject({ kind: 'menu', view: 'run-details', active: true });
      expect((rows[1] as { active: boolean }).active).toBe(false);
    });

    it('exposes the current filter text on the filter row', () => {
      const rows = buildRowModel({ groups: [], filter: 'glm', activeView: 'dashboard' });
      expect(rows[0]).toMatchObject({ kind: 'filter', filter: 'glm' });
    });

    it('appends group headers and their runs below the separator', () => {
      const runs = [mockRun('r1', { startedAt: at(10) }), mockRun('r2', { startedAt: at(11) })];
      const groups = groupRunsByDate(runs);
      const rows = buildRowModel({ groups, filter: '', activeView: 'dashboard' });

      // filter + 4 menu + separator + (group-header + run + run)
      expect(rows.map((r) => r.kind)).toEqual([
        'filter',
        'menu',
        'menu',
        'menu',
        'menu',
        'separator',
        'group-header',
        'run',
        'run',
      ]);
      expect(rows[6]).toMatchObject({ kind: 'group-header', label: 'Today' });
      expect((rows[7] as { runId: string }).runId).toBe('r1');
      expect((rows[8] as { runId: string }).runId).toBe('r2');
    });

    it('keeps the placeholder "no runs" case compact', () => {
      const rows = buildRowModel({ groups: [], filter: 'nope', activeView: 'dashboard' });
      expect(rows).toHaveLength(6);
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
      // 0..8; selectable = 0,1,2,3,4,7,8
      expect(selectableRowIndices(rows)).toEqual([0, 1, 2, 3, 4, 7, 8]);
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
      expect(moveSelection(rows, -1, -1)).toBe(8); // last selectable (second run)
    });

    it('moves down through selectable rows and skips separators/headers', () => {
      expect(moveSelection(rows, 0, 1)).toBe(1); // filter → first menu
      expect(moveSelection(rows, 4, 1)).toBe(7); // last menu → first run
      expect(moveSelection(rows, 7, 1)).toBe(8); // run → run
    });

    it('moves up through selectable rows and skips separators/headers', () => {
      expect(moveSelection(rows, 7, -1)).toBe(4); // first run → last menu
      expect(moveSelection(rows, 1, -1)).toBe(0); // first menu → filter
      expect(moveSelection(rows, 8, -1)).toBe(7); // last run → prev run
    });

    it('clamps at the ends of the selectable subset', () => {
      expect(moveSelection(rows, 8, 1)).toBe(8); // last → last
      expect(moveSelection(rows, 0, -1)).toBe(0); // first → first
    });

    it('snaps an off-list current to the nearest selectable row', () => {
      // Current points at separator (row 5); delta doesn't matter — snap to first.
      expect(moveSelection(rows, 5, 1)).toBe(0);
      expect(moveSelection(rows, 6, -1)).toBe(0); // group-header → first
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
