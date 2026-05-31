import os from 'os';
import path from 'path';
import { existsSync, readdirSync, statSync } from 'fs';
import { AgentDef } from './registry';

export function loadGenericAgents(): AgentDef[] {
  const baseDir = process.env.AT_GENERIC_DIR ?? path.join(os.homedir(), '.at');

  if (!existsSync(baseDir)) return [];

  const agents: AgentDef[] = [];

  let entries: string[];
  try {
    entries = readdirSync(baseDir);
  } catch (err) {
    console.warn(`[at] generic-loader: cannot read ${baseDir}: ${(err as Error).message}`);
    return [];
  }

  for (const entry of entries) {
    if (entry.includes(path.sep)) continue;

    const entryPath = path.join(baseDir, entry);
    const resolvedEntry = path.resolve(entryPath);
    const resolvedBase = path.resolve(baseDir);
    if (!resolvedEntry.startsWith(resolvedBase + path.sep)) continue;

    try {
      if (!statSync(entryPath).isDirectory()) continue;

      const genericFile = path.join(entryPath, 'generic.js');
      if (!existsSync(genericFile)) continue;

      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mod = require(genericFile) as Partial<AgentDef>;

      if (typeof mod.tier !== 'number' || ![1, 2, 3].includes(mod.tier)) {
        throw new Error(`missing or invalid 'tier' (must be 1, 2, or 3)`);
      }
      if (typeof mod.bin !== 'function') {
        throw new Error(`missing 'bin' function`);
      }
      if (typeof mod.buildArgs !== 'function') {
        throw new Error(`missing 'buildArgs' function`);
      }

      agents.push({
        name: entry,
        tier: mod.tier as 1 | 2 | 3,
        bin: mod.bin,
        buildArgs: mod.buildArgs,
        ...(mod.buildEnv ? { buildEnv: mod.buildEnv } : {}),
        ...(mod.promptMode ? { promptMode: mod.promptMode } : {}),
      });
    } catch (err) {
      console.warn(`[at] generic-loader: skipping '${entry}': ${(err as Error).message}`);
    }
  }

  return agents;
}
