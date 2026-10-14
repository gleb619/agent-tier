import { existsSync } from "node:fs";
import { loadBoard, mutateBoard, resolveBoardFile, toTasks } from "../kanban/board";
import { type AddOptions, type OpResult, opAdd, opRemove, opStatus } from "../kanban/ops";
import { nextExecutable } from "../kanban/select";
import { BridgeError, type BridgeParams, type BridgeResource } from "./types";
import { optionalString, requireString, storeError } from "./util";

/**
 * `bridge kanban list|show|next` — read-only board views (no lock, no mutation).
 * `bridge kanban add|status|remove` — stdin-JSON mirrors of `at kanban`
 * mutations. Every verb goes through `mutateBoard`, which holds the board
 * file lock (same serialization as the CLI).
 */

function loadBoardFrom(params: BridgeParams) {
  const explicit = params.board;
  if (explicit !== undefined && (typeof explicit !== "string" || explicit.length === 0)) {
    throw new BridgeError("USAGE", "param 'board' must be a non-empty string", 2);
  }
  const file = resolveBoardFile(explicit as string | undefined);
  if (!existsSync(file)) {
    throw new BridgeError("NOT_FOUND", `kanban board not found: ${file}`);
  }
  return loadBoard(file);
}

function addOptions(params: BridgeParams): AddOptions {
  return {
    id: optionalString(params, "id"),
    title: optionalString(params, "title"),
    priority: optionalString(params, "priority"),
    owner: optionalString(params, "owner"),
    blocks: optionalString(params, "blocks"),
    blockedBy: optionalString(params, "blockedBy"),
    plan: optionalString(params, "plan"),
    description: optionalString(params, "description"),
  };
}

async function mutate(params: BridgeParams, fn: (doc: Parameters<typeof opAdd>[0]) => OpResult | Promise<OpResult>) {
  const file = resolveBoardFile(optionalString(params, "board"));
  try {
    const r = await mutateBoard(file, fn);
    return { file, ...((r.data ?? {}) as object), warnings: r.warnings };
  } catch (err) {
    throw storeError(err, "INVALID");
  }
}

export const kanbanResource: BridgeResource = {
  list: (params) => toTasks(loadBoardFrom(params)),
  show: (params) => {
    const id = params.id;
    if (typeof id !== "string" || id.trim().length === 0) {
      throw new BridgeError("USAGE", "param 'id' (non-empty string) is required", 2);
    }
    const task = toTasks(loadBoardFrom(params)).find((t) => (t.ID ?? "").trim() === id.trim());
    if (!task) throw new BridgeError("NOT_FOUND", `task not found: ${id}`);
    return task;
  },
  next: (params) => nextExecutable(toTasks(loadBoardFrom(params))),

  /** params: `{ title?, priority?, description?, id?, …, board? }` — mirrors `at kanban add` flags. */
  add: (params) => mutate(params, (doc) => opAdd(doc, addOptions(params))),

  /** params: `{ id, status, board? }` — status vocabulary comes from the board Status Legend. */
  status: (params) =>
    mutate(params, (doc) => opStatus(doc, requireString(params, "id"), requireString(params, "status"))),

  /** params: `{ id, board? }`. */
  remove: (params) => mutate(params, (doc) => opRemove(doc, requireString(params, "id"))),
};
