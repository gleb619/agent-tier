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
  it('returns per-tier path by default', () => {
    expect(getStateFile(2, false)).toBe('/tmp/at-2-state.json');
  });

  it('returns global path when globalState=true', () => {
    expect(getStateFile(2, true)).toBe('/tmp/at-global-state.json');
  });
});

describe('pickAgent', () => {
  let stateFile: string;

  beforeEach(() => {
    stateFile = path.join(os.tmpdir(), `at-test-${Date.now()}.json`);
  });

  afterEach(() => {
    if (fs.existsSync(stateFile)) fs.unlinkSync(stateFile);
  });

  it('starts at index 0 with no state file', () => {
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
    expect(state.index).toBe(0);
  });
});
