import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { logLines, setLogLines, logFilter, setLogFilter, scrollOffset, setScrollOffset, VISIBLE_LINES, goToHead, goToTail, showPrompt, setShowPrompt } from '../../src/tui/store/log';
import { lineColor } from '../../src/tui/components/LogViewer';

describe('log store', () => {
  beforeEach(() => {
    setLogLines([]);
    setLogFilter('');
    setScrollOffset(0);
    setShowPrompt(false);
  });

  afterEach(() => {
    setLogLines([]);
    setLogFilter('');
    setScrollOffset(0);
    setShowPrompt(false);
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

  describe('showPrompt signal', () => {
    it('starts false', () => {
      expect(showPrompt()).toBe(false);
    });

    it('can be set to true', () => {
      setShowPrompt(true);
      expect(showPrompt()).toBe(true);
    });

    it('can be toggled', () => {
      setShowPrompt((v) => !v);
      expect(showPrompt()).toBe(true);
      setShowPrompt((v) => !v);
      expect(showPrompt()).toBe(false);
    });
  });
});

describe('LogViewer pure functions', () => {
  describe('lineColor', () => {
    it('returns red for error lines', () => {
      expect(lineColor('[ERROR] something failed')).toBe('#f85149');
      expect(lineColor('error: oops')).toBe('#f85149');
      expect(lineColor('Error occurred')).toBe('#f85149');
      expect(lineColor('[FAIL] test')).toBe('#f85149');
    });

    it('returns yellow for warn lines', () => {
      expect(lineColor('[WARN] caution')).toBe('#d29922');
      expect(lineColor('warn: be careful')).toBe('#d29922');
      expect(lineColor('Warning!')).toBe('#d29922');
    });

    it('returns grey for info lines', () => {
      expect(lineColor('[INFO] hello')).toBe('#8b949e');
      expect(lineColor('info: something')).toBe('#8b949e');
    });

    it('returns dark grey for debug lines', () => {
      expect(lineColor('[DEBUG] trace')).toBe('#484f58');
      expect(lineColor('debug: details')).toBe('#484f58');
    });

    it('returns green for success lines', () => {
      expect(lineColor('✓ passed')).toBe('#3fb950');
      expect(lineColor('success!')).toBe('#3fb950');
      expect(lineColor('done')).toBe('#3fb950');
      expect(lineColor('complete')).toBe('#3fb950');
    });

    it('returns default for plain lines', () => {
      expect(lineColor('hello world')).toBe('#c9d1d9');
    });
  });
});
