import { agentsResource } from "./agents";
import { configResource } from "./config";
import { feedbackResource } from "./feedback";
import { kanbanResource } from "./kanban";
import { pingResource } from "./ping";
import { runsResource } from "./runs";
import { statusResource } from "./status";
import type { BridgeContext, BridgeParams } from "./types";
import { BridgeError } from "./types";

/**
 * Resource registry: one entry per file in src/bridge/. To add a resource,
 * create `src/bridge/<name>.ts` exporting a `BridgeResource` and add it here.
 * Verbs must be thin wrappers over existing store/command functions —
 * never parse CLI text output inside a handler.
 */
const RESOURCES: Record<string, typeof pingResource> = {
  ping: pingResource,
  agents: agentsResource,
  runs: runsResource,
  status: statusResource,
  feedback: feedbackResource,
  kanban: kanbanResource,
  config: configResource,
};

export function listBridgeResources(): string[] {
  return Object.keys(RESOURCES);
}

/** Dispatch one `bridge <resource> <verb>` call and return the payload. */
export function dispatchBridge(resource: string, verb: string, params: BridgeParams, ctx: BridgeContext): unknown {
  const verbs = RESOURCES[resource];
  if (!verbs) {
    throw new BridgeError(
      "UNKNOWN_RESOURCE",
      `unknown bridge resource: ${resource} (usage: at bridge <resource> <verb>)`,
      2,
    );
  }
  const handler = verbs[verb];
  if (!handler) {
    const known = Object.keys(verbs).join(", ");
    throw new BridgeError("UNKNOWN_VERB", `unknown verb '${verb}' for resource '${resource}' (known: ${known})`, 2);
  }
  return handler(params, ctx);
}
