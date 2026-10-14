import { existsSync } from "node:fs";
import { loadBoard, resolveBoardFile, toTasks } from "../kanban/board";
import { nextExecutable } from "../kanban/select";
import { BridgeError, type BridgeParams, type BridgeResource } from "./types";

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

/** `bridge kanban list|show|next` — read-only board views (no lock, no mutation). */
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
};
