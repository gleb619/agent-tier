import os from "os";
import path from "path";
import { loadGenericAgents } from "./agents/generic-loader";
import { AGENTS, type AgentDef, getAgentsByTier } from "./agents/registry";
import { getLineAgents, loadConfig } from "./config";
import { loadStateFile } from "./scheduler";
import { getStateFilePath } from "./state-dir";

/** One agent slot in a scheduler queue; `current` marks the round-robin index. */
export interface DiagramAgent {
  name: string;
  current: boolean;
}

/** One scheduler key (line / tier-N / legacy N) with its full ordered queue. */
export interface DiagramGroup {
  key: string;
  /** Which state dir the entry came from (joined reports only). */
  scope?: "project" | "global";
  agents: DiagramAgent[];
}

/** `~/.at` is the global scope; every other state dir is project-local. */
export function scopeOfStateDir(stateDir: string): "project" | "global" {
  return stateDir === path.join(os.homedir(), ".at") ? "global" : "project";
}

/** Display label for a group: `[scope] key` when scoped, bare key otherwise. */
export function diagramGroupLabel(group: DiagramGroup): string {
  return group.scope ? `[${group.scope}] ${group.key}` : group.key;
}

/**
 * Resolve the full ordered agent queue for every scheduler key in the given
 * state dirs — the shared model both the `at status` mermaid diagram and the
 * TUI dashboard render from. Keys resolve exactly like `buildStateReport`:
 * `line` via the config line queue, `tier-N` / bare `N` via the registry tier,
 * anything else against the whole agent list. Groups whose queue cannot be
 * resolved (e.g. an empty line config) are skipped.
 */
export function resolveSchedulerDiagram(dirs: string | string[]): DiagramGroup[] {
  const list = Array.isArray(dirs) ? dirs : [dirs];
  const scoped = list.length > 1;
  const allAgents = [...AGENTS, ...loadGenericAgents()];
  const config = loadConfig({ quiet: true });

  const groups: DiagramGroup[] = [];
  for (const dir of list) {
    const state = loadStateFile(getStateFilePath(dir));
    if (!state.scheduler) continue;
    const scope = scoped ? scopeOfStateDir(dir) : undefined;

    for (const [key, sched] of Object.entries(state.scheduler)) {
      let agents: AgentDef[];
      try {
        if (key === "line") {
          agents = getLineAgents(allAgents, config, { quiet: true });
        } else {
          const tierMatch = key.match(/^tier-([1-4])$/) || key.match(/^([1-4])$/);
          agents = tierMatch ? getAgentsByTier(Number(tierMatch[1]) as 1 | 2 | 3 | 4) : allAgents;
        }
      } catch {
        agents = [];
      }
      if (agents.length === 0) continue;
      groups.push({
        key,
        scope,
        agents: agents.map((a, i) => ({ name: a.name, current: i === sched.index })),
      });
    }
  }
  return groups;
}

/**
 * Render the scheduler diagram as a fenced mermaid `flowchart LR` block: one
 * subgraph per scheduler key, agents in queue order chained left-to-right,
 * with a wrap edge back to the start (round-robin is modulo rotation) and the
 * agent at the current index drawn as a double circle with the `current`
 * class. Returns an empty string when there is nothing to draw.
 */
export function buildSchedulerMermaid(groups: DiagramGroup[]): string {
  const usable = groups.filter((g) => g.agents.length > 0);
  if (usable.length === 0) return "";

  const lines: string[] = ["flowchart LR"];
  usable.forEach((group, gi) => {
    const gid = `g${gi}`;
    lines.push(`  subgraph ${gid}["${diagramGroupLabel(group)}"]`);
    lines.push("    direction LR");
    const ids = group.agents.map((_, i) => `${gid}_n${i}`);
    group.agents.forEach((agent, i) => {
      const shape = agent.current ? `(("${agent.name}"))` : `["${agent.name}"]`;
      lines.push(`    ${ids[i]}${shape}${agent.current ? ":::current" : ""}`);
    });
    for (let i = 0; i < ids.length - 1; i++) {
      lines.push(`    ${ids[i]} --> ${ids[i + 1]}`);
    }
    if (ids.length > 1) {
      lines.push(`    ${ids[ids.length - 1]} --> ${ids[0]}`);
    }
    lines.push("  end");
  });
  lines.push("  classDef current fill:#1f6feb,stroke:#58a6ff,color:#ffffff;");

  return "```mermaid\n" + lines.join("\n") + "\n```";
}
