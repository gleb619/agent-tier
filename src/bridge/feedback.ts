import {
  addFeedback,
  type FeedbackEntry,
  type FeedbackKind,
  type FeedbackStatus,
  getFeedback,
  listFeedback,
  removeFeedback,
  updateFeedback,
} from "../feedback-store";
import { loadRuns } from "../run-store";
import { resolveFeedbackDir } from "../state-dir";
import type { BridgeParams, BridgeResource } from "./types";
import { BridgeError } from "./types";
import {
  optionalBoolean,
  optionalNumber,
  optionalString,
  optionalStringArray,
  requireString,
  storeError,
} from "./util";

/**
 * `bridge feedback list|get` — same store + dir resolution as `at feedback`.
 * `bridge feedback add|update|resolve|rm` — stdin-JSON mirrors of `at feedback`
 * flags. Writes go through feedback-store, which takes the feedback.jsonl lock
 * (same as the CLI).
 */

const KINDS: FeedbackKind[] = ["bug", "improvement", "note"];
const STATUSES: FeedbackStatus[] = ["open", "resolved", "wontfix"];

function optionalStringRaw(params: BridgeParams, name: string): string | undefined {
  const raw = params[name];
  if (raw === undefined) return undefined;
  if (typeof raw !== "string" || raw.length === 0) {
    throw new BridgeError("USAGE", `param '${name}' must be a non-empty string`, 2);
  }
  return raw;
}

function filterFrom(params: BridgeParams) {
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
    status: optionalStringRaw(params, "status"),
    kind: optionalStringRaw(params, "kind"),
    agent: optionalStringRaw(params, "agent"),
    tag: optionalStringRaw(params, "tag"),
    limit,
  };
}

function requireKind(value: string | undefined): FeedbackKind | undefined {
  if (value === undefined) return undefined;
  if (!KINDS.includes(value as FeedbackKind)) {
    throw new BridgeError("INVALID", "kind must be bug, improvement, or note");
  }
  return value as FeedbackKind;
}

function requireStatus(value: string | undefined): FeedbackStatus | undefined {
  if (value === undefined) return undefined;
  if (!STATUSES.includes(value as FeedbackStatus)) {
    throw new BridgeError("INVALID", "status must be open, resolved, or wontfix");
  }
  return value as FeedbackStatus;
}

/** getFeedback throws "not found"/"ambiguous" — normalize to machine codes. */
function requireEntry(stateDir: string, id: string): FeedbackEntry {
  try {
    const entry = getFeedback(stateDir, id);
    if (!entry) throw new BridgeError("NOT_FOUND", `feedback not found: ${id}`);
    return entry;
  } catch (err) {
    if (err instanceof BridgeError) throw err;
    throw storeError(err);
  }
}

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

  /** params: `{ text, kind?, agent?, runId?, tier?, tags?, context? }` (mirrors `at feedback add` flags). */
  async add(params) {
    const text = requireString(params, "text");
    if (text.length > 4000) {
      throw new BridgeError("INVALID", "feedback text exceeds 4000 characters");
    }
    const kind = requireKind(optionalString(params, "kind")) ?? "note";
    const stateDir = resolveFeedbackDir();

    // `at feedback add --run` autofill: agent/tier from the run when found.
    let agent = optionalString(params, "agent");
    let tier = optionalNumber(params, "tier");
    const runId = optionalString(params, "runId");
    if (runId) {
      const run = loadRuns(stateDir).find((r) => r.runId === runId || r.runId.startsWith(runId));
      if (run) {
        agent = agent ?? run.agent;
        tier = tier ?? run.tier;
      }
    }

    const { entry, evicted } = await addFeedback(stateDir, {
      text,
      kind,
      agent,
      runId,
      tier,
      tags: optionalStringArray(params, "tags"),
      context: optionalString(params, "context"),
      cwd: process.cwd(),
    });
    return { entry, evicted };
  },

  /** params: `{ id, text?, kind?, status?, agent?, tags? }` (mirrors `at feedback update` flags). */
  async update(params) {
    const id = requireString(params, "id");
    const stateDir = resolveFeedbackDir();
    requireEntry(stateDir, id);

    const entry = await updateFeedback(stateDir, id, {
      text: optionalString(params, "text"),
      kind: requireKind(optionalString(params, "kind")),
      status: requireStatus(optionalString(params, "status")),
      agent: optionalString(params, "agent"),
      tags: optionalStringArray(params, "tags"),
    });
    return { entry };
  },

  /** params: `{ id, wontfix? }` — mark resolved (or wontfix). */
  async resolve(params) {
    const id = requireString(params, "id");
    const stateDir = resolveFeedbackDir();
    requireEntry(stateDir, id);

    const status: FeedbackStatus = optionalBoolean(params, "wontfix") ? "wontfix" : "resolved";
    const entry = await updateFeedback(stateDir, id, { status });
    return { entry };
  },

  /** params: `{ ids: string[] }` — remove entries by id or unique prefix. */
  async rm(params) {
    const ids = params.ids;
    if (!Array.isArray(ids) || ids.length === 0 || ids.some((v) => typeof v !== "string")) {
      throw new BridgeError("INVALID", "param 'ids' must be a non-empty array of strings");
    }
    const stateDir = resolveFeedbackDir();
    for (const id of ids) {
      requireEntry(stateDir, id);
    }

    const removed = await removeFeedback(stateDir, ids as string[]);
    return { removed };
  },
};