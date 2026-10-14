import { buildAgentsReport } from "../agents/report";
import type { BridgeResource } from "./types";

/** `bridge agents list` — same payload `at agents --json` prints today. No params. */
export const agentsResource: BridgeResource = {
  list: (_params, ctx) => buildAgentsReport(ctx.stateDirs),
  // Same registry∪health merge as `list`, health fields only — one entry per
  // registered agent, defaults for agents with no health record on disk.
  health: (_params, ctx) =>
    buildAgentsReport(ctx.stateDirs).map(({ name, deactivated, failures, lastFailure, disabledTo }) => ({
      name,
      deactivated,
      failures,
      lastFailure,
      disabledTo,
    })),
};
