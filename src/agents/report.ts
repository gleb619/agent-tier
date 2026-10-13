import { buildStateReportFor } from "../status";
import { loadGenericAgents } from "./generic-loader";
import { AGENTS } from "./registry";

/** One entry of the merged registry+health payload: what `GET /api/agents`
 *  serves and what `at agents --json` prints. Field order matches the Node
 *  web server response ({ tier, promptMode, ...health, name }). */
export interface AgentReportEntry {
  tier: number;
  promptMode?: "arg" | "stdin";
  deactivated: boolean;
  failures: number;
  lastFailure: string | null;
  disabledTo: string | null;
  name: string;
}

const HEALTH_DEFAULTS = { deactivated: false, failures: 0, lastFailure: null, disabledTo: null };

/** Merge the agent registry with per-dir health state (earlier dir wins per
 *  name), exactly like the /api/agents handler in src/web/server.ts. */
export function buildAgentsReport(stateDirs: string[]): AgentReportEntry[] {
  const healthByName = new Map(buildStateReportFor(stateDirs).agents.map((a) => [a.name, a]));
  return [...AGENTS, ...loadGenericAgents()].map((a) => ({
    tier: a.tier,
    ...(a.promptMode ? { promptMode: a.promptMode } : {}),
    ...(healthByName.get(a.name) ?? HEALTH_DEFAULTS),
    name: a.name,
  }));
}
