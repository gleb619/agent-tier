import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { type BoardDoc, findRowById, headerIndex, mutateBoard, toTasks } from "../kanban/board";
import { type OpResult, resolvePlanPath } from "../kanban/ops";
import { setCellText } from "../kanban/parse";
import { backlogCandidates } from "../kanban/select";
import { blank, IN_PROGRESS, type Task } from "../kanban/types";
import { acquireLock, getLockDir, type LockInfo, pathToLockName, releaseLock } from "../lock";
import { isPidAlive } from "../process-utils";
import { type ComposeTask, parsePlanKeywords, type TaskSource } from "./task-source";

/**
 * The only compose module that imports kanban. The board is human-edited, so
 * every op re-loads it inside the file lock (via mutateBoard) — nothing here
 * caches board state.
 */

export interface KanbanStatusMap {
  claim: string;
  DONE: string;
  FAILED: string;
}

export interface KanbanSourceOptions {
  boardFile: string;
  statusMap?: Partial<KanbanStatusMap>;
  /** Sink for warnings (e.g. a mapped status missing from the board legend). */
  log?: (msg: string) => void;
}

export interface KanbanSource extends TaskSource {
  readonly boardFile: string;
  /** Claim one specific task by id (used by `--task`). */
  claimId(id: string): Promise<ComposeTask | null>;
}

const DEFAULT_MAP: KanbanStatusMap = { claim: IN_PROGRESS, DONE: "Done", FAILED: "Blocked" };

/**
 * Lease wait bound: the lease is probed before it is taken and claims serialize on the
 * board lock, so this only covers the microsecond race where two claimers probe the same
 * free task at once. Long enough to lose cleanly, short enough to never stall a loop.
 */
const LEASE_TIMEOUT_MS = 250;

/**
 * Per-task claim lease on lock.ts's own naming scheme: the lease "state file" is
 * `<boardFile>.claim-<ID>`, so the lock lands in `<boardDir>/locks/` — the directory board
 * mutations already use, derived from the board path so it works for any board (`--board`,
 * another project, a temp file) — and the name carries the whole board path plus the task
 * id, so leases of different boards or tasks never collide with each other, nor with the
 * board's own mutation lock (which comes from `<boardFile>` alone).
 *
 * The compose process that claims a task holds its lease until `onFinish`; while the file
 * names a live pid nobody else may take the task, and when that process dies the pid is
 * dead, lock.ts's stale-lock steal frees it, and the next claim resumes the task.
 */
function leaseFile(boardFile: string, id: string): string {
  return path.join(getLockDir(boardFile), pathToLockName(`${boardFile}.claim-${id}`));
}

/** Live pid owning the lease, or null when free (absent, dead pid or unreadable). */
function leaseHolder(lease: string): number | null {
  try {
    const info = JSON.parse(readFileSync(lease, "utf8")) as LockInfo;
    return typeof info?.pid === "number" && isPidAlive(info.pid) ? info.pid : null;
  } catch {
    return null;
  }
}

function leaseFree(boardFile: string, id: string): boolean {
  return leaseHolder(leaseFile(boardFile, id)) === null;
}

/**
 * Take the lease for `id`. Returns null when it is ours now, otherwise the holder's pid
 * (0 when the acquire timed out on a live lock we could not read a pid from).
 */
async function takeLease(boardFile: string, id: string): Promise<number | null> {
  const lease = leaseFile(boardFile, id);
  const holder = leaseHolder(lease);
  if (holder !== null) return holder;
  try {
    await acquireLock(`${boardFile}.claim-${id}`, LEASE_TIMEOUT_MS);
    return null;
  } catch {
    return leaseHolder(lease) ?? 0;
  }
}

/** Drop the lease, but only when this process owns it — never free another claimer's task. */
function releaseLease(boardFile: string, id: string): void {
  const lease = leaseFile(boardFile, id);
  try {
    if ((JSON.parse(readFileSync(lease, "utf8")) as LockInfo).pid !== process.pid) return;
  } catch {
    return;
  }
  releaseLock(lease);
}

function noopResult(data: unknown = null): OpResult {
  return { messages: [], warnings: [], changed: false, data };
}

/** Plan-file keywords for the INVESTIGATE query; a missing/unreadable plan just means none. */
function planKeywords(planFile: string): string[] | undefined {
  try {
    const kw = parsePlanKeywords(readFileSync(planFile, "utf8"));
    return kw.length > 0 ? kw : undefined;
  } catch {
    return undefined;
  }
}

function toComposeTask(doc: BoardDoc, task: Task): ComposeTask {
  const planRaw = (task["Plan File"] ?? "").replace(/`/g, "").trim();
  const planFile = blank(planRaw) ? undefined : resolvePlanPath(doc.file, planRaw);
  return {
    id: task.ID,
    title: task.Title ?? "",
    description: blank(task.Description) ? "" : task.Description,
    planFile,
    keywords: planFile ? planKeywords(planFile) : undefined,
  };
}

/**
 * Claim order, deliberately the mirror of opNext: an already-claimed task is resumed first
 * (crashed run or human hand-off), so `--loop` never starts new work while a task sits
 * abandoned mid-flight. Exclusivity comes from the per-task lease, not from preferring
 * Backlog — a task whose lease names a live pid is skipped entirely, so two concurrent
 * claimers can never be handed the same row. Runs inside mutateBoard's board lock.
 */
async function opClaim(doc: BoardDoc, claimStatus: string, wantId?: string): Promise<OpResult> {
  if (!doc.statuses.includes(claimStatus)) {
    return {
      ...noopResult(),
      warnings: [`[kanban-source] status "${claimStatus}" not in board legend; claim skipped`],
    };
  }
  const statusIdx = headerIndex(doc, "Status");
  if (statusIdx === -1) {
    return { ...noopResult(), warnings: ["[kanban-source] board has no Status column; claim skipped"] };
  }

  const tasks = toTasks(doc);
  let task: Task | undefined;
  let mark = false;
  if (wantId) {
    const wanted = tasks.find((t) => t.ID === wantId);
    if (!wanted) return { ...noopResult(), warnings: [`[kanban-source] task ${wantId} not found`] };
    const holder = await takeLease(doc.file, wantId);
    if (holder !== null) {
      return { ...noopResult(), warnings: [`[kanban-source] task ${wantId} is claimed by pid ${holder}`] };
    }
    task = wanted;
    mark = task.Status !== claimStatus;
  } else {
    // (a) resume an unleased task in the claim status, (b) else the best unblocked Backlog
    // task — both skip any row a live process has leased. Row order keeps (a) deterministic.
    task = tasks.find((t) => t.Status === claimStatus && leaseFree(doc.file, t.ID));
    if (!task) {
      task = backlogCandidates(tasks).find((t) => leaseFree(doc.file, t.ID));
      mark = task !== undefined;
    }
    if (!task) return noopResult();
    // Only reachable if another process leased it between the probe and here: lose cleanly.
    if ((await takeLease(doc.file, task.ID)) !== null) return noopResult();
  }

  if (mark) {
    const rowIdx = findRowById(doc, task.ID);
    if (rowIdx === -1) {
      releaseLease(doc.file, task.ID);
      return { ...noopResult(), warnings: [`[kanban-source] task ${task.ID} row not found`] };
    }
    setCellText(doc.table.children[rowIdx].children[statusIdx], claimStatus);
    task = { ...task, Status: claimStatus };
  }
  return { messages: [], warnings: [], changed: mark, data: { task: toComposeTask(doc, task) } };
}

function opFinish(doc: BoardDoc, taskId: string, status: string, goalDir: string): OpResult {
  if (!doc.statuses.includes(status)) {
    return {
      ...noopResult(),
      warnings: [`[kanban-source] status "${status}" not in board legend; ${taskId} left unchanged`],
    };
  }
  const rowIdx = findRowById(doc, taskId);
  if (rowIdx === -1) return { ...noopResult(), warnings: [`[kanban-source] task ${taskId} not found`] };
  const row = doc.table.children[rowIdx];
  setCellText(row.children[headerIndex(doc, "Status")], status);

  const planIdx = headerIndex(doc, "Plan File");
  if (
    status === DEFAULT_MAP.FAILED &&
    planIdx >= 0 &&
    blank(toTasks(doc).find((t) => t.ID === taskId)?.["Plan File"])
  ) {
    setCellText(row.children[planIdx], path.join(goalDir, "plan.md"));
  }
  return { messages: [], warnings: [], changed: true, data: null };
}

export function createKanbanSource(opts: KanbanSourceOptions): KanbanSource {
  const boardFile = path.resolve(opts.boardFile);
  const map: KanbanStatusMap = { ...DEFAULT_MAP, ...opts.statusMap };
  const log = opts.log ?? ((msg: string) => console.warn(msg));

  const claimWith = async (wantId?: string): Promise<ComposeTask | null> => {
    const r = await mutateBoard(boardFile, (doc) => opClaim(doc, map.claim, wantId));
    for (const w of r.warnings) log(w);
    const data = r.data as { task?: ComposeTask } | null;
    return data?.task ?? null;
  };

  return {
    boardFile,
    claim: () => claimWith(),
    claimId: (id) => claimWith(id),
    async onFinish(task, outcome, info) {
      // Release even when the artifact write or the board op throws: the run is over, and a
      // leased row nobody is working would block the next claim's resume path forever.
      try {
        if (outcome === "FAILED") {
          await mkdir(info.goalDir, { recursive: true });
          await writeFile(
            path.join(info.goalDir, "outcome.md"),
            `# ${task.id} — FAILED\n\nCompose run failed after round ${info.round}. See plan.md / verdict.md in this directory.\n`,
          );
        }
        const r = await mutateBoard(boardFile, (doc) => opFinish(doc, task.id, map[outcome], info.goalDir));
        for (const w of r.warnings) log(w);
      } finally {
        releaseLease(boardFile, task.id);
      }
    },
  };
}
