import { describe, it, expect } from 'vitest';
import {
  tier,
  agent,
  mode,
  retries,
  cycleTier,
  cycleAgent,
  cycleMode,
  cycleRetries,
} from '../../../src/tui/store/settings';

// Solid.js createSignal creates module-level singletons. Each test must reset
// to a known state: tier=2, agent='auto', mode='stream', retries=0
function resetToKnown() {
  // Reset tier: cycle until tier=2
  // This also resets agent to 'auto' (called on every cycleTier even when tier wraps)
  while (tier() !== 2) {
    cycleTier();
  }
  // Reset mode: cycle until mode='stream'
  while (mode() !== 'stream') {
    cycleMode();
  }
  // Reset retries: cycle until retries=0
  while (retries() !== 0) {
    cycleRetries();
  }
}

describe('settings store', () => {
  describe('cycleTier', () => {
    it('cycles tier 2 → 3 and resets agent to auto', () => {
      resetToKnown();
      cycleTier();
      expect(tier()).toBe(3);
      expect(agent()).toBe('auto');
    });

    it('cycles tier 3 → 1 and resets agent to auto', () => {
      resetToKnown();
      cycleTier();
      cycleTier();
      expect(tier()).toBe(1);
      expect(agent()).toBe('auto');
    });

    it('cycles tier 1 → 2 and resets agent to auto', () => {
      resetToKnown();
      cycleTier();
      cycleTier();
      cycleTier();
      expect(tier()).toBe(2);
      expect(agent()).toBe('auto');
    });
  });

  describe('cycleAgent (tier 2)', () => {
    it('cycles auto → blackbox', () => {
      resetToKnown();
      cycleAgent();
      expect(agent()).toBe('blackbox');
    });

    it('cycles blackbox → mm-code', () => {
      resetToKnown();
      cycleAgent();
      cycleAgent();
      expect(agent()).toBe('mm-code');
    });

    it('cycles mm-code → opencode', () => {
      resetToKnown();
      cycleAgent();
      cycleAgent();
      cycleAgent();
      expect(agent()).toBe('opencode');
    });

    it('cycles opencode → qwen', () => {
      resetToKnown();
      cycleAgent();
      cycleAgent();
      cycleAgent();
      cycleAgent();
      expect(agent()).toBe('qwen');
    });

    it('cycles qwen → pi', () => {
      resetToKnown();
      cycleAgent();
      cycleAgent();
      cycleAgent();
      cycleAgent();
      cycleAgent();
      expect(agent()).toBe('pi');
    });

    it('cycles pi → auto (wraps around)', () => {
      resetToKnown();
      cycleAgent();
      cycleAgent();
      cycleAgent();
      cycleAgent();
      cycleAgent();
      cycleAgent();
      expect(agent()).toBe('auto');
    });
  });

  describe('cycleMode', () => {
    it('toggles stream → detached', () => {
      resetToKnown();
      cycleMode();
      expect(mode()).toBe('detached');
    });

    it('toggles detached → stream', () => {
      resetToKnown();
      cycleMode();
      cycleMode();
      expect(mode()).toBe('stream');
    });
  });

  describe('cycleRetries', () => {
    it('cycles 0 → 1', () => {
      resetToKnown();
      cycleRetries();
      expect(retries()).toBe(1);
    });

    it('cycles 1 → 2', () => {
      resetToKnown();
      cycleRetries();
      cycleRetries();
      expect(retries()).toBe(2);
    });

    it('cycles 2 → 3', () => {
      resetToKnown();
      cycleRetries();
      cycleRetries();
      cycleRetries();
      expect(retries()).toBe(3);
    });

    it('cycles 3 → 0 (wraps around)', () => {
      resetToKnown();
      cycleRetries();
      cycleRetries();
      cycleRetries();
      cycleRetries();
      expect(retries()).toBe(0);
    });
  });
});