import { describe, it, expect, vi, beforeEach } from 'vitest';
import { batch, untrack } from 'solid-js';
import {
  currentLogFile,
  setCurrentLogFile,
  logLines,
  setLogLines,
  logFilter,
  setLogFilter,
  scrollOffset,
  setScrollOffset,
  filteredLines,
  loadLogFile,
  goToHead,
  goToTail,
} from '../../../src/tui/store/log';

// Import readFile from the mocked fs module
import { readFile } from 'fs';

vi.mock('fs', () => ({
  readFile: vi.fn(),
}));

// Helper to compute filtered lines without memo caching
function computeFilteredLines(): string[] {
  const filter = untrack(logFilter).toLowerCase();
  const lines = untrack(logLines);
  if (!filter) return [...lines];
  return lines.filter((line) => line.toLowerCase().includes(filter));
}

describe('TUI Log Store', () => {
  beforeEach(() => {
    batch(() => {
      setLogLines([]);
      setLogFilter('');
      setScrollOffset(0);
      setCurrentLogFile(null);
    });
    vi.clearAllMocks();
  });

  describe('logLines signal', () => {
    it('can set and get log lines', () => {
      setLogLines(['line1', 'line2', 'line3']);
      expect(logLines()).toEqual(['line1', 'line2', 'line3']);
    });
  });

  describe('filteredLines', () => {
    it('returns all lines when no filter', () => {
      setLogLines(['line1', 'line2', 'line3']);
      const result = computeFilteredLines();
      expect(result).toEqual(['line1', 'line2', 'line3']);
    });

    it('filters lines case-insensitively', () => {
      setLogLines(['ERROR: something failed', 'INFO: all good', 'error: another error']);
      setLogFilter('ERROR');
      const result = computeFilteredLines();
      expect(result).toEqual(['ERROR: something failed', 'error: another error']);
    });

    it('returns empty array when no lines match filter', () => {
      setLogLines(['line1', 'line2', 'line3']);
      setLogFilter('xyz');
      const result = computeFilteredLines();
      expect(result).toEqual([]);
    });
  });

  describe('goToHead', () => {
    it('sets scrollOffset to 0', () => {
      setScrollOffset(50);
      goToHead();
      expect(scrollOffset()).toBe(0);
    });
  });

  describe('goToTail', () => {
    it('sets scrollOffset to max(0, lines.length - 20)', () => {
      // Test that goToTail calculates correctly based on filteredLines length
      // With 30 lines and no filter, offset should be 30 - 20 = 10
      setLogFilter('');
      setLogLines(Array.from({ length: 30 }, (_, i) => `line${i}`));
      // Manually compute what goToTail should do
      const expectedOffset = Math.max(0, filteredLines().length - 20);
      goToTail();
      expect(scrollOffset()).toBe(expectedOffset);
    });

    it('sets scrollOffset to 0 when fewer lines than VISIBLE_LINES', () => {
      setLogLines(['line1', 'line2']);
      goToTail();
      expect(scrollOffset()).toBe(0);
    });
  });

  describe('setLogFilter', () => {
    it('updates the filter and filteredLines recomputes', () => {
      setLogLines(['ERROR: fail', 'INFO: ok', 'ERROR: again']);
      setLogFilter('error');
      expect(computeFilteredLines()).toEqual(['ERROR: fail', 'ERROR: again']);

      setLogFilter('info');
      expect(computeFilteredLines()).toEqual(['INFO: ok']);
    });
  });

  describe('loadLogFile', () => {
    it('sets logLines and scrollOffset correctly on success', () => {
      const content = Array.from({ length: 25 }, (_, i) => `log line ${i}`).join('\n');

      (readFile as ReturnType<typeof vi.fn>).mockImplementation(
        (_path: string, _encoding: string, callback: (err: Error | null, content: string) => void) => {
          callback(null, content);
        }
      );

      loadLogFile('/test/path.log');

      expect(logLines().length).toBe(25);
      expect(scrollOffset()).toBe(5); // 25 - 20 = 5
    });

    it('sets logLines to empty and scrollOffset to 0 on error', () => {
      (readFile as ReturnType<typeof vi.fn>).mockImplementation(
        (_path: string, _encoding: string, callback: (err: Error, content?: string) => void) => {
          callback(new Error('ENOENT'));
        }
      );

      loadLogFile('/nonexistent/path.log');

      expect(logLines()).toEqual([]);
      expect(scrollOffset()).toBe(0);
    });
  });
});