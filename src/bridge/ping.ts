import { CLI_VERSION } from "../version";
import type { BridgeResource } from "./types";

/** `bridge ping ping` — smoke verb for proxy health checks. No params. */
export const pingResource: BridgeResource = {
  ping: () => ({ version: CLI_VERSION }),
};
