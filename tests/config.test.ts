import { readFileSync } from 'fs';
import { computeHmac, loadConfig, applyTierOverrides, AtConfig, CONFIG_FILE, HMAC_FILE } from '../src/config';
import { AgentDef } from '../src/agents/registry';
import { Mock } from 'vitest';

vi.mock('fs');

const mockReadFileSync = readFileSync as Mock;

function makeAgent(name: string, tier: 1 | 2 | 3 = 2): AgentDef {
  return { name, tier, bin: () => '/usr/bin/true', buildArgs: (p) => [p] };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('loadConfig', () => {
  it('returns null when config file does not exist', () => {
    mockReadFileSync.mockImplementation((p) => {
      if (p === CONFIG_FILE) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      throw new Error('unexpected');
    });
    expect(loadConfig()).toBeNull();
    expect(console.warn).not.toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();
  });

  it('warns and returns null when HMAC file does not exist', () => {
    const configData = JSON.stringify({ tierOverrides: { pi: 2 } });
    mockReadFileSync.mockImplementation((p) => {
      if (p === CONFIG_FILE) return configData;
      if (p === HMAC_FILE) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      throw new Error('unexpected');
    });
    expect(loadConfig()).toBeNull();
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('no HMAC'));
  });

  it('errors and returns null when HMAC does not match', () => {
    const configData = JSON.stringify({ tierOverrides: { pi: 2 } });
    mockReadFileSync.mockImplementation((p) => {
      if (p === CONFIG_FILE) return configData;
      if (p === HMAC_FILE) return 'deadbeef';
      throw new Error('unexpected');
    });
    expect(loadConfig()).toBeNull();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('HMAC mismatch'));
  });

  it('errors and returns null when JSON is invalid', () => {
    const configData = 'not-json{{{';
    const hmac = computeHmac(configData);
    mockReadFileSync.mockImplementation((p) => {
      if (p === CONFIG_FILE) return configData;
      if (p === HMAC_FILE) return hmac;
      throw new Error('unexpected');
    });
    expect(loadConfig()).toBeNull();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('not valid JSON'));
  });

  it('returns parsed config when HMAC matches', () => {
    const configData = JSON.stringify({ tierOverrides: { pi: 2, goose: 1 } });
    const hmac = computeHmac(configData);
    mockReadFileSync.mockImplementation((p) => {
      if (p === CONFIG_FILE) return configData;
      if (p === HMAC_FILE) return hmac;
      throw new Error('unexpected');
    });
    const result = loadConfig();
    expect(result).toEqual({ tierOverrides: { pi: 2, goose: 1 } });
    expect(console.warn).not.toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();
  });
});

describe('applyTierOverrides', () => {
  const agents = [makeAgent('blackbox', 2), makeAgent('pi', 3), makeAgent('goose', 3)];

  it('returns agents unchanged when config is null', () => {
    const result = applyTierOverrides(agents, null);
    expect(result).toEqual(agents);
  });

  it('returns agents unchanged when tierOverrides is absent', () => {
    const result = applyTierOverrides(agents, {} as AtConfig);
    expect(result).toEqual(agents);
  });

  it('overrides the tier of the named agent and leaves others unchanged', () => {
    const result = applyTierOverrides(agents, { tierOverrides: { pi: 2 } });
    expect(result.find((a) => a.name === 'pi')?.tier).toBe(2);
    expect(result.find((a) => a.name === 'blackbox')?.tier).toBe(2);
    expect(result.find((a) => a.name === 'goose')?.tier).toBe(3);
  });

  it('does not mutate the original agent objects', () => {
    const original = agents[1]; // pi, tier 3
    applyTierOverrides(agents, { tierOverrides: { pi: 2 } });
    expect(original.tier).toBe(3);
  });
});
