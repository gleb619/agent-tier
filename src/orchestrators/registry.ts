import os from 'os';
import path from 'path';
import { AgentDef } from '../agents/registry';

export type OrchestratorDef = AgentDef;

const AT_HOME = process.env.AT_GENERIC_DIR ?? path.join(os.homedir(), '.at');

export const ORCHESTRATORS: OrchestratorDef[] = [
  {
    name: 'orch',
    tier: 1,
    bin: () => process.execPath,
    buildArgs: (prompt) => [path.join(AT_HOME, 'orch', 'generic.js'), prompt],
  },
];

export function getOrchestratorsByTier(tier: 1 | 2 | 3): OrchestratorDef[] {
  return ORCHESTRATORS.filter((o) => o.tier === tier);
}

export function getOrchestratorByName(name: string): OrchestratorDef | undefined {
  return ORCHESTRATORS.find((o) => o.name === name);
}