import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { logLines, setLogLines, logFilter, setLogFilter, scrollOffset, setScrollOffset, VISIBLE_LINES, goToHead, goToTail } from '../../src/tui/store/log';

describe('log store', () => {
  beforeEach(() => {
    setLogLines([]);
    setLogFilter('');
    setScrollOffset(0);
  });

  afterEach(() => {
    setLogLines([]);
    setLogFilter('');
    setScrollOffset(0);
  });

  describe('goToHead', () => {
    it('sets scrollOffset to 0 regardless of current value', () => {
      setScrollOffset(100);
      goToHead();
      expect(scrollOffset()).toBe(0);
    });

    it('works when already at 0', () => {
      goToHead();
      expect(scrollOffset()).toBe(0);
    });
  });

  describe('goToTail', () => {
    it('scrolls to 0 when log has fewer lines than VISIBLE_LINES', () => {
      setLogLines(['a', 'b', 'c']);
      goToTail();
      expect(scrollOffset()).toBe(0); // max(0, 3 - 20) = 0
    });

    // Note: goToTail depends on filteredLines() which uses createMemo.
    // In vitest (SSR environment), createMemo does not track reactive dependencies.
    // The actual goToTail behavior is tested in the app during manual testing.
  });

  describe('VISIBLE_LINES', () => {
    it('is set to 20', () => {
      expect(VISIBLE_LINES).toBe(20);
    });
  });

  describe('logFilter signal', () => {
    it('starts empty', () => {
      expect(logFilter()).toBe('');
    });

    it('can be set and retrieved', () => {
      setLogFilter('error');
      expect(logFilter()).toBe('error');
    });

    it('can be cleared', () => {
      setLogFilter('error');
      setLogFilter('');
      expect(logFilter()).toBe('');
    });
  });

  describe('scrollOffset signal', () => {
    it('starts at 0', () => {
      expect(scrollOffset()).toBe(0);
    });

    it('can be set to arbitrary values', () => {
      setScrollOffset(5);
      expect(scrollOffset()).toBe(5);
    });
  });

  describe('logLines signal', () => {
    it('starts empty', () => {
      expect(logLines()).toEqual([]);
    });

    it('can store log lines', () => {
      const lines = ['[INFO] started', '[DEBUG] running', '[ERROR] failed'];
      setLogLines(lines);
      expect(logLines()).toEqual(lines);
    });
  });
});