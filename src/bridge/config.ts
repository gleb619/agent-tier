import { loadConfig } from "../config";
import type { BridgeResource } from "./types";

/**
 * `bridge config get` — the current `~/.at/config.json` (HMAC-verified, same as
 * every other consumer). Returns `{}` when missing/tampered. AtConfig holds no
 * secrets — the HMAC secret lives in AT_HMAC_SECRET, never on disk — so there
 * is nothing to redact.
 */
export const configResource: BridgeResource = {
  get: () => loadConfig({ quiet: true }) ?? {},
};
