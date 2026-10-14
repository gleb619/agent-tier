import { BridgeError, type BridgeParams } from "./types";

/**
 * Shared helpers for bridge mutation verbs (docs/plans/bridge-03-mutations.md).
 * All mutations reuse the CLI store/command functions; these helpers only add
 * stdin-schema validation and machine-coded error mapping.
 */

/** Run fn with console.log silenced — reused CLI fns log progress to stdout, which the bridge contract reserves for JSON. */
export async function withoutStdoutLogs<T>(fn: () => T | Promise<T>): Promise<T> {
  const original = console.log;
  console.log = () => {};
  try {
    return await fn();
  } finally {
    console.log = original;
  }
}

/**
 * Map a store/command error to a machine-coded BridgeError: "not found" →
 * NOT_FOUND, ambiguous/lock-timeout → CONFLICT, anything else → fallback
 * (handlers pass "INVALID" for schema-ish store rejections).
 */
export function storeError(err: unknown, fallback = "INTERNAL"): BridgeError {
  const text = err instanceof Error ? err.message : String(err);
  if (/not found/i.test(text) || /ENOENT/.test(text)) {
    return new BridgeError("NOT_FOUND", text);
  }
  if (/ambiguous/i.test(text) || /Failed to acquire lock/.test(text)) {
    return new BridgeError("CONFLICT", text);
  }
  return new BridgeError(fallback, text);
}

export function requireString(params: BridgeParams, key: string): string {
  const value = params[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new BridgeError("INVALID", `param '${key}' must be a non-empty string`);
  }
  return value;
}

export function optionalString(params: BridgeParams, key: string): string | undefined {
  const value = params[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new BridgeError("INVALID", `param '${key}' must be a string`);
  }
  return value;
}

export function optionalBoolean(params: BridgeParams, key: string): boolean | undefined {
  const value = params[key];
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") {
    throw new BridgeError("INVALID", `param '${key}' must be a boolean`);
  }
  return value;
}

export function optionalNumber(params: BridgeParams, key: string): number | undefined {
  const value = params[key];
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new BridgeError("INVALID", `param '${key}' must be a number`);
  }
  return value;
}

export function optionalStringArray(params: BridgeParams, key: string): string[] | undefined {
  const value = params[key];
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) {
    throw new BridgeError("INVALID", `param '${key}' must be an array of strings`);
  }
  return value;
}
