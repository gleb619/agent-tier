/** Shared types for the `at bridge` JSON RPC surface (see docs/bridge.md). */

/** Verb params: the parsed stdin JSON object (`{}` when stdin is empty). */
export type BridgeParams = Record<string, unknown>;

/** Per-invocation context handed to every verb handler. */
export interface BridgeContext {
  /** State dirs to read (same join logic as `at status` / `at agents`). */
  stateDirs: string[];
}

export type BridgeHandler = (params: BridgeParams, ctx: BridgeContext) => unknown | Promise<unknown>;

/**
 * Error with a machine-readable code for the bridge error envelope.
 * `exitCode` 2 = usage/unknown resource|verb, 3 = app error (see docs/bridge.md).
 */
export class BridgeError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly exitCode: 2 | 3 = 3,
  ) {
    super(message);
    this.name = "BridgeError";
  }
}

/** A resource is one file in src/bridge/ exporting a verb → handler map. */
export type BridgeResource = Record<string, BridgeHandler>;
