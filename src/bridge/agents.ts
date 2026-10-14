import { buildAgentsReport } from "../agents/report";
import type { BridgeResource } from "./types";

/** `bridge agents list` — same payload `at agents --json` prints today. No params. */
export const agentsResource: BridgeResource = {
  list: (_params, ctx) => buildAgentsReport(ctx.stateDirs),
};
