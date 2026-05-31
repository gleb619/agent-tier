import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';
import { submitPrompt } from '../../src/tui/launch';

vi.mock('child_process', async () => {
  const { EventEmitter } = await import('events');
  return {
    spawn: vi.fn(() => {
      const child = new EventEmitter() as any;
      child.pid = 12345;
      child.stdin = null;
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      return child;
    }),
  };
});

vi.mock('fs', () => ({
  appendFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

vi.mock('../../src/tui/store/log', () => ({
  setLogLines: vi.fn(),
  refreshLog: vi.fn(),
}));

vi.mock('../../src/tui/store/sessions', () => ({
  refreshSessions: vi.fn(),
}));

import { spawn } from 'child_process';
import { refreshSessions } from '../../src/tui/store/sessions';

describe('TUI Launch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('submitPrompt', () => {
    it('builds correct args in detached mode without -s flag', () => {
      submitPrompt('test prompt', {
        tier: 2,
        agent: 'auto',
        mode: 'detached',
        retries: 0,
      });

      expect(spawn).toHaveBeenCalledWith(
        'at',
        ['-p', 'test prompt', '-t', '2'],
        expect.objectContaining({ detached: true, stdio: 'ignore' })
      );
    });

    it('includes -s flag in stream mode', () => {
      submitPrompt('test prompt', {
        tier: 2,
        agent: 'auto',
        mode: 'stream',
        retries: 0,
      });

      expect(spawn).toHaveBeenCalledWith(
        'at',
        expect.arrayContaining(['-p', 'test prompt', '-t', '2', '-s']),
        expect.any(Object)
      );
    });

    it('passes correct tier via -t flag', () => {
      submitPrompt('prompt', {
        tier: 3,
        agent: 'auto',
        mode: 'detached',
        retries: 0,
      });

      const args = (spawn as ReturnType<typeof vi.fn>).mock.calls[0][1];
      expect(args).toContain('-t');
      expect(args).toContain('3');
    });

    it('passes agent name via -a flag when specified', () => {
      submitPrompt('prompt', {
        tier: 2,
        agent: 'kimi',
        mode: 'detached',
        retries: 0,
      });

      const args = (spawn as ReturnType<typeof vi.fn>).mock.calls[0][1];
      expect(args).toContain('-a');
      expect(args).toContain('kimi');
    });

    it('does not pass -a flag when agent is auto', () => {
      submitPrompt('prompt', {
        tier: 2,
        agent: 'auto',
        mode: 'detached',
        retries: 0,
      });

      const args = (spawn as ReturnType<typeof vi.fn>).mock.calls[0][1];
      expect(args).not.toContain('-a');
    });

    it('passes retries via -r flag when retries > 0', () => {
      submitPrompt('prompt', {
        tier: 2,
        agent: 'auto',
        mode: 'detached',
        retries: 3,
      });

      const args = (spawn as ReturnType<typeof vi.fn>).mock.calls[0][1];
      expect(args).toContain('-r');
      expect(args).toContain('3');
    });

    it('does not pass -r flag when retries is 0', () => {
      submitPrompt('prompt', {
        tier: 2,
        agent: 'auto',
        mode: 'detached',
        retries: 0,
      });

      const args = (spawn as ReturnType<typeof vi.fn>).mock.calls[0][1];
      expect(args).not.toContain('-r');
    });

    it('spawns child process correctly in detached mode', () => {
      submitPrompt('prompt', {
        tier: 2,
        agent: 'auto',
        mode: 'detached',
        retries: 0,
      });

      expect(spawn).toHaveBeenCalledTimes(1);
      expect(spawn).toHaveBeenCalledWith(
        'at',
        expect.any(Array),
        expect.objectContaining({ detached: true })
      );
    });

    it('spawns child process correctly in stream mode', () => {
      submitPrompt('prompt', {
        tier: 2,
        agent: 'auto',
        mode: 'stream',
        retries: 0,
      });

      expect(spawn).toHaveBeenCalledTimes(1);
      expect(spawn).toHaveBeenCalledWith(
        'at',
        expect.any(Array),
        expect.objectContaining({ detached: false, stdio: 'pipe' })
      );
    });

    it('calls refreshSessions after spawning', () => {
      vi.useFakeTimers();
      submitPrompt('prompt', {
        tier: 2,
        agent: 'auto',
        mode: 'detached',
        retries: 0,
      });

      vi.advanceTimersByTime(500);
      expect(refreshSessions).toHaveBeenCalledTimes(1);
      vi.useRealTimers();
    });
  });
});