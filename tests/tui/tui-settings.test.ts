import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { tier, agent, mode, retries, loadSettings } from '../../src/tui/store/settings';

vi.mock('fs', () => ({
  readFileSync: vi.fn(() => {
    throw new Error('ENOENT');
  }),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  existsSync: vi.fn(() => false),
}));

describe('settings store', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

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

  describe('loadSettings', () => {
    it('does nothing when state.json is missing', () => {
      (readFileSync as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error('ENOENT');
      });
      loadSettings();
      expect(tier()).toBe(2);
      expect(agent()).toBe('auto');
      expect(mode()).toBe('stream');
      expect(retries()).toBe(0);
    });

    it('loads valid tui.settings from state.json', () => {
      (readFileSync as ReturnType<typeof vi.fn>).mockImplementation(() =>
        JSON.stringify({
          tui: {
            settings: {
              tier: 3,
              agent: 'kilo',
              mode: 'detached',
              retries: 2,
            },
          },
        })
      );
      loadSettings();
      expect(tier()).toBe(3);
      expect(agent()).toBe('kilo');
      expect(mode()).toBe('detached');
      expect(retries()).toBe(2);
    });
  });
});
