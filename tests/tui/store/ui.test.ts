import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { batch } from 'solid-js';
import { focusZone, setFocusZone, loadUIState, saveUIState } from '../../../src/tui/store/ui';

vi.mock('fs', () => ({
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

vi.mock('../../../src/state-dir', () => ({
  resolveStateDir: vi.fn().mockReturnValue('/test/state'),
  getStateFilePath: vi.fn().mockReturnValue('/test/state/state.json'),
}));

import { readFileSync, writeFileSync, mkdirSync } from 'fs';

describe('TUI UI Store', () => {
  beforeEach(() => {
    batch(() => {
      setFocusZone(4);
    });
    vi.clearAllMocks();
  });

  describe('focusZone signal', () => {
    it('has correct initial value of 4', () => {
      expect(focusZone()).toBe(4);
    });

    it('can be updated', () => {
      setFocusZone(1);
      expect(focusZone()).toBe(1);
    });

    it('clamps values to valid range 0-4', () => {
      setFocusZone(0);
      expect(focusZone()).toBe(0);
      setFocusZone(4);
      expect(focusZone()).toBe(4);
    });
  });

  describe('loadUIState', () => {
    it('returns default when file is missing', () => {
      (readFileSync as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error('ENOENT');
      });

      loadUIState();

      expect(focusZone()).toBe(4);
    });

    it('reads saved state from file', () => {
      (readFileSync as ReturnType<typeof vi.fn>).mockReturnValue(
        JSON.stringify({ tui: { focusZone: 2 } })
      );

      loadUIState();

      expect(focusZone()).toBe(2);
    });

    it('clamps focusZone to valid range', () => {
      (readFileSync as ReturnType<typeof vi.fn>).mockReturnValue(
        JSON.stringify({ tui: { focusZone: 10 } })
      );

      loadUIState();

      expect(focusZone()).toBe(4);
    });

    it('handles malformed JSON gracefully', () => {
      (readFileSync as ReturnType<typeof vi.fn>).mockReturnValue('not valid json');

      loadUIState();

      expect(focusZone()).toBe(4);
    });

    it('ignores missing tui key in JSON', () => {
      (readFileSync as ReturnType<typeof vi.fn>).mockReturnValue(JSON.stringify({}));

      loadUIState();

      expect(focusZone()).toBe(4);
    });
  });

  describe('saveUIState', () => {
    it('writes valid JSON to state file', () => {
      (readFileSync as ReturnType<typeof vi.fn>).mockReturnValue('{}');

      saveUIState(2);

      expect(writeFileSync).toHaveBeenCalledWith(
        '/test/state/state.json',
        JSON.stringify({ tui: { focusZone: 2 } }, null, 2),
        'utf8'
      );
    });

    it('merges with existing state', () => {
      (readFileSync as ReturnType<typeof vi.fn>).mockReturnValue(
        JSON.stringify({ other: 'data', tui: { focusZone: 1 } })
      );

      saveUIState(3);

      const writtenData = JSON.parse((writeFileSync as ReturnType<typeof vi.fn>).mock.calls[0][1] as string);
      expect(writtenData.other).toBe('data');
      expect(writtenData.tui.focusZone).toBe(3);
    });

    it('creates state dir if missing', () => {
      (readFileSync as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error('ENOENT');
      });

      saveUIState(0);

      expect(mkdirSync).toHaveBeenCalledWith('/test/state', { recursive: true });
    });

    it('handles malformed existing JSON gracefully', () => {
      (readFileSync as ReturnType<typeof vi.fn>).mockReturnValue('not json');

      saveUIState(1);

      expect(writeFileSync).toHaveBeenCalledWith(
        '/test/state/state.json',
        JSON.stringify({ tui: { focusZone: 1 } }, null, 2),
        'utf8'
      );
    });
  });
});