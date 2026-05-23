import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { pickAgent, getStateFile } from '../src/scheduler';
import { AgentDef } from '../src/agents/registry';

function makeAgent(name: string): AgentDef {
  return { name, tier: 2, bin: () => `/usr/bin/${name}`, buildArgs: (p) => [p] };
}

const agents = [makeAgent('a'), makeAgent('b'), makeAgent('c')];

describe('getStateFile', () => {
  it('returns state.json inside the given state dir', () => {
    expect(getStateFile(2, '/home/user/.at')).toBe('/home/user/.at/state.json');
  });

  it('ignores tier and prefix', () => {
    expect(getStateFile(1, '/tmp/test', 'at-orch')).toBe('/tmp/test/state.json');
  });
});

describe('pickAgent', () => {
  let stateFile: string;
  let stateDir: string;

  beforeEach(() => {
    stateDir = path.join(os.tmpdir(), `at-test-${Date.now()}`);
    stateFile = path.join(stateDir, 'state.json');
    fs.mkdirSync(stateDir, { recursive: true });
  });

  afterEach(() => {
    if (fs.existsSync(stateFile)) fs.unlinkSync(stateFile);
    try { fs.rmdirSync(stateDir); } catch { /* not empty */ }
  });

  it('starts at index 0 with no state file', () => {
    // Delete the file so pickAgent starts fresh
    if (fs.existsSync(stateFile)) fs.unlinkSync(stateFile);
    expect(pickAgent(agents, stateFile).name).toBe('a');
  });

  it('advances to next agent on each call', () => {
    expect(pickAgent(agents, stateFile).name).toBe('a');
    expect(pickAgent(agents, stateFile).name).toBe('b');
    expect(pickAgent(agents, stateFile).name).toBe('c');
  });

  it('wraps around to 0 after last agent', () => {
    pickAgent(agents, stateFile);
    pickAgent(agents, stateFile);
    pickAgent(agents, stateFile);
    expect(pickAgent(agents, stateFile).name).toBe('a');
  });

  it('persists index to state file after each pick', () => {
    pickAgent(agents, stateFile);
    const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    expect(state.scheduler.default.index).toBe(0);
  });

  it('uses different keys for different scheduler contexts', () => {
    expect(pickAgent(agents, stateFile, 'tier-1').name).toBe('a');
    expect(pickAgent(agents, stateFile, 'tier-1').name).toBe('b');
    // Different key starts fresh
    expect(pickAgent(agents, stateFile, 'tier-2').name).toBe('a');
  });
});
