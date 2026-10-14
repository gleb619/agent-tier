import { readFileSync } from "node:fs";
import type { Command } from "commander";
import { loadGenericAgents } from "../agents/generic-loader";
import { AGENTS } from "../agents/registry";
import { type AtConfig, CONFIG_FILE, getLineAgents, loadConfig, saveConfig } from "../config";

/**
 * Raw read of config.json without HMAC verification — used by the line
 * mutations, which then persist via {@link saveConfig} (write + re-sign).
 */
export function readRawConfig(): AtConfig | null {
  try {
    return JSON.parse(readFileSync(CONFIG_FILE, "utf8")) as AtConfig;
  } catch {
    return null;
  }
}

function getAllAgents(): { name: string; tier: 1 | 2 | 3 | 4 }[] {
  const all = [...AGENTS, ...loadGenericAgents()];
  return all.map((a) => ({ name: a.name, tier: a.tier }));
}

export function validateAgentName(name: string): void {
  const all = getAllAgents();
  if (!all.find((a) => a.name === name)) {
    const valid = all
      .map((a) => a.name)
      .sort()
      .join(", ");
    throw new Error(`unknown agent "${name}". valid agents: ${valid}`);
  }
}

/** Append an agent to the line queue and re-sign the config. Throws on duplicate/unknown. */
export function lineAdd(agentName: string): void {
  validateAgentName(agentName);
  const raw = readRawConfig() ?? ({} as AtConfig);
  raw.line = raw.line ?? [];
  if (raw.line.includes(agentName)) {
    throw new Error(`agent "${agentName}" already in line queue`);
  }
  raw.line.push(agentName);
  saveConfig(raw);
}

/** Remove an agent from the line queue and re-sign the config. Throws when absent. */
export function lineRemove(agentName: string): void {
  validateAgentName(agentName);
  const raw = readRawConfig();
  if (!raw?.line) {
    throw new Error("line queue is not configured");
  }
  const idx = raw.line.indexOf(agentName);
  if (idx === -1) {
    throw new Error(`agent "${agentName}" not in line queue`);
  }
  raw.line.splice(idx, 1);
  saveConfig(raw);
}

/** Move an agent to a new 1-based position and re-sign the config. Throws when absent/out of range. */
export function lineMove(agentName: string, position: number): void {
  validateAgentName(agentName);
  const raw = readRawConfig();
  if (!raw?.line) {
    throw new Error("line queue is not configured");
  }
  const idx = raw.line.indexOf(agentName);
  if (idx === -1) {
    throw new Error(`agent "${agentName}" not in line queue`);
  }
  if (!Number.isInteger(position) || position < 1 || position > raw.line.length) {
    throw new Error(`position must be 1..${raw.line.length}`);
  }
  const [moved] = raw.line.splice(idx, 1);
  raw.line.splice(position - 1, 0, moved);
  saveConfig(raw);
}

export function registerLineCommand(program: Command): void {
  const line = program
    .command("line")
    .description("Manage the line-mode agent queue (single ordered queue when no -t flag)");

  line
    .command("show")
    .description("Print the effective line-mode queue (configured or default)")
    .action(() => {
      try {
        const config = loadConfig();
        const allAgents = [...AGENTS, ...loadGenericAgents()];
        const effective = getLineAgents(allAgents, config);

        if (config?.line) {
          console.log("[at] line mode (configured):");
          for (let i = 0; i < effective.length; i++) {
            console.log(`  ${i + 1}. ${effective[i].name} (tier ${effective[i].tier})`);
          }
        } else {
          console.log("[at] line mode (default — tier 3 first, then 2, then 1, mocks excluded):");
          for (let i = 0; i < effective.length; i++) {
            console.log(`  ${i + 1}. ${effective[i].name} (tier ${effective[i].tier})`);
          }
          console.log("\nConfigure with: at line add <agent>");
        }
      } catch (err) {
        console.error(`[at] error: ${(err as Error).message}`);
        process.exit(1);
      }
    });

  line
    .command("add <agent>")
    .description("Append an agent to the line-mode queue")
    .action((agentName: string) => {
      try {
        lineAdd(agentName);
        console.log(`[at] added "${agentName}" to line queue`);
      } catch (err) {
        console.error(`[at] error: ${(err as Error).message}`);
        process.exit(1);
      }
    });

  line
    .command("rm <agent>")
    .alias("remove")
    .description("Remove an agent from the line-mode queue")
    .action((agentName: string) => {
      try {
        lineRemove(agentName);
        console.log(`[at] removed "${agentName}" from line queue`);
      } catch (err) {
        console.error(`[at] error: ${(err as Error).message}`);
        process.exit(1);
      }
    });

  line
    .command("move <agent> <position>")
    .description("Move an agent to a new 1-based position in the line-mode queue")
    .action((agentName: string, posStr: string) => {
      try {
        lineMove(agentName, Number(posStr));
        console.log(`[at] moved "${agentName}" to position ${Number(posStr)}`);
      } catch (err) {
        console.error(`[at] error: ${(err as Error).message}`);
        process.exit(1);
      }
    });
}
