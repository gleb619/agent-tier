import { describe, it, expect } from 'vitest';
import { tier, agent, mode, retries } from '../src/tui/store/settings';

describe('settings store', () => {
  // Settings store uses module-level signals that persist across tests.
  // We read the current state and test transitions from that state.

  describe('defaults', () => {
    it('defaults tier to 2', () => {
      expect(tier()).toBe(2);
    });

    it('defaults agent to auto', () => {
      expect(agent()).toBe('auto');
    });

    it('defaults mode to stream', () => {
      expect(mode()).toBe('stream');
    });

    it('defaults retries to 0', () => {
      expect(retries()).toBe(0);
    });
  });
});