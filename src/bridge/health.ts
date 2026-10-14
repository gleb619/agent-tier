import { buildStateReportFor } from "../status";
import type { BridgeResource } from "./types";

/** `bridge health get` — scheduler + agent-health snapshot (read-only). */
export const healthResource: BridgeResource = {
  get: (_params, ctx) => buildStateReportFor(ctx.stateDirs),
};
