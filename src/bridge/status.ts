import { buildStatusSnapshot } from "../status";
import type { BridgeResource } from "./types";

/** `bridge status get` — the exact object `at status --json` prints (same code path). No params. */
export const statusResource: BridgeResource = {
  get: (_params, ctx) => buildStatusSnapshot(ctx.stateDirs),
};
