import { readFileSync, writeFileSync } from 'fs';
import { AgentDef } from './agents/registry';

interface SchedulerState {
  index: number;
}

export function getStateFile(tier: number, globalState: boolean, prefix = 'at'): string {
  return globalState ? '/tmp/at-global-state.json' : `/tmp/${prefix}-${tier}-state.json`;
}

export function pickAgent(agents: AgentDef[], stateFile: string): AgentDef {
  let state: SchedulerState = { index: -1 };
  try {
    state = JSON.parse(readFileSync(stateFile, 'utf8'));
  } catch {
    // no state file yet — -1 so first advance lands on index 0
  }
  const nextIndex = (state.index + 1) % agents.length;
  writeFileSync(stateFile, JSON.stringify({ index: nextIndex }), 'utf8');
  return agents[nextIndex];
}
