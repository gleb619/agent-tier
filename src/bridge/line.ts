import { lineAdd, lineMove, lineRemove, readRawConfig, validateAgentName } from "../commands/line";
import { BridgeError, type BridgeResource } from "./types";
import { optionalNumber, requireString } from "./util";

/**
 * `bridge line add|rm|move` — stdin-JSON mirrors of `at line add|rm|move`.
 * Config mutations go through the same write + HMAC-sign path as the CLI
 * (`saveConfig` in src/config.ts).
 */

function requireValidAgent(params: Record<string, unknown>): string {
  const agent = requireString(params, "agent");
  try {
    validateAgentName(agent);
  } catch {
    throw new BridgeError("INVALID", `unknown agent "${agent}"`);
  }
  return agent;
}

function configuredLine(): string[] {
  return readRawConfig()?.line ?? [];
}

export const lineResource: BridgeResource = {
  /** params: `{ agent }` — append to the line queue. Duplicate → CONFLICT. */
  async add(params) {
    const agent = requireValidAgent(params);
    if (configuredLine().includes(agent)) {
      throw new BridgeError("CONFLICT", `agent "${agent}" already in line queue`);
    }
    lineAdd(agent);
    return { agent, line: configuredLine() };
  },

  /** params: `{ agent }` — remove from the line queue. Absent → NOT_FOUND. */
  async rm(params) {
    const agent = requireValidAgent(params);
    if (!readRawConfig()?.line) {
      throw new BridgeError("NOT_FOUND", "line queue is not configured");
    }
    if (!configuredLine().includes(agent)) {
      throw new BridgeError("NOT_FOUND", `agent "${agent}" not in line queue`);
    }
    lineRemove(agent);
    return { agent, line: configuredLine() };
  },

  /** params: `{ agent, position }` — move to a 1-based position. Out of range → INVALID. */
  async move(params) {
    const agent = requireValidAgent(params);
    const position = optionalNumber(params, "position");
    const line = configuredLine();
    if (!readRawConfig()?.line) {
      throw new BridgeError("NOT_FOUND", "line queue is not configured");
    }
    if (!line.includes(agent)) {
      throw new BridgeError("NOT_FOUND", `agent "${agent}" not in line queue`);
    }
    if (position === undefined || !Number.isInteger(position) || position < 1 || position > line.length) {
      throw new BridgeError("INVALID", `position must be 1..${line.length}`);
    }
    lineMove(agent, position);
    return { agent, position, line: configuredLine() };
  },
};
