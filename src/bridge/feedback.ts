import { type FeedbackFilter, getFeedback, listFeedback } from "../feedback-store";
import { resolveFeedbackDir } from "../state-dir";
import { BridgeError, type BridgeParams, type BridgeResource } from "./types";

function optionalString(params: BridgeParams, name: string): string | undefined {
  const raw = params[name];
  if (raw === undefined) return undefined;
  if (typeof raw !== "string" || raw.length === 0) {
    throw new BridgeError("USAGE", `param '${name}' must be a non-empty string`, 2);
  }
  return raw;
}

function filterFrom(params: BridgeParams): FeedbackFilter {
  const limitRaw = params.limit;
  let limit: number | undefined;
  if (limitRaw !== undefined) {
    const n = Number(limitRaw);
    if (!Number.isFinite(n) || n < 1) {
      throw new BridgeError("USAGE", "param 'limit' must be a positive number", 2);
    }
    limit = Math.floor(n);
  }
  return {
    status: optionalString(params, "status") as FeedbackFilter["status"],
    kind: optionalString(params, "kind") as FeedbackFilter["kind"],
    agent: optionalString(params, "agent"),
    tag: optionalString(params, "tag"),
    limit,
  };
}

/** `bridge feedback list|get` — same store + dir resolution as `at feedback`. */
export const feedbackResource: BridgeResource = {
  list: (params) => listFeedback(resolveFeedbackDir(), filterFrom(params)),
  get: (params) => {
    const id = params.id;
    if (typeof id !== "string" || id.trim().length === 0) {
      throw new BridgeError("USAGE", "param 'id' (non-empty string) is required", 2);
    }
    try {
      return getFeedback(resolveFeedbackDir(), id);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.startsWith("ambiguous feedback id")) {
        throw new BridgeError("USAGE", message, 2);
      }
      throw new BridgeError("NOT_FOUND", message);
    }
  },
};
