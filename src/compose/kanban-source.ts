import { mkdir, writeFile } from 'fs/promises'
import path from 'path'
import {
  findRowById,
  headerIndex,
  mutateBoard,
  toTasks,
  type BoardDoc,
} from '../kanban/board'
import { resolvePlanPath, type OpResult } from '../kanban/ops'
import { setCellText } from '../kanban/parse'
import { isUnblocked, nextExecutable } from '../kanban/select'
import {
  DEFAULT_STATUS,
  IN_PROGRESS,
  PRIORITY_ORDER,
  UNKNOWN_PRIORITY,
  blank,
  numericId,
  type Task,
} from '../kanban/types'
import type { ComposeTask, TaskFinishInfo, TaskSource } from './task-source'

/**
 * The only compose module that imports kanban. The board is human-edited, so
 * every op re-loads it inside the file lock (via mutateBoard) — nothing here
 * caches board state.
 */

export interface KanbanStatusMap {
  claim: string
  DONE: string
  FAILED: string
}

export interface KanbanSourceOptions {
  boardFile: string
  statusMap?: Partial<KanbanStatusMap>
  /** Sink for warnings (e.g. a mapped status missing from the board legend). */
  log?: (msg: string) => void
}

export interface KanbanSource extends TaskSource {
  readonly boardFile: string
  /** Claim one specific task by id (used by `--task`). */
  claimId(id: string): Promise<ComposeTask | null>
}

const DEFAULT_MAP: KanbanStatusMap = { claim: IN_PROGRESS, DONE: 'Done', FAILED: 'Blocked' }

function noopResult(data: unknown = null): OpResult {
  return { messages: [], warnings: [], changed: false, data }
}

function toComposeTask(doc: BoardDoc, task: Task): ComposeTask {
  const planRaw = (task['Plan File'] ?? '').replace(/`/g, '').trim()
  return {
    id: task.ID,
    title: task.Title ?? '',
    description: blank(task.Description) ? '' : task.Description,
    planFile: blank(planRaw) ? undefined : resolvePlanPath(doc.file, planRaw),
  }
}

/**
 * opNext start semantics, with one deliberate difference: an In Progress task
 * is only resumed when no Backlog task is executable. opNext returns the
 * current task first, which would hand the same task to two concurrent claims;
 * here the lock + backlog-first order guarantees a fresh claim never collides.
 */
function opClaim(doc: BoardDoc, claimStatus: string, wantId?: string): OpResult {
  if (!doc.statuses.includes(claimStatus)) {
    return {
      ...noopResult(),
      warnings: [`[kanban-source] status "${claimStatus}" not in board legend; claim skipped`],
    }
  }
  const statusIdx = headerIndex(doc, 'Status')
  if (statusIdx === -1) {
    return { ...noopResult(), warnings: ['[kanban-source] board has no Status column; claim skipped'] }
  }

  const tasks = toTasks(doc)
  let task: Task | undefined
  let mark = false
  if (wantId) {
    task = tasks.find(t => t.ID === wantId)
    if (!task) return { ...noopResult(), warnings: [`[kanban-source] task ${wantId} not found`] }
    mark = task.Status !== claimStatus
  } else {
    const candidates = tasks.filter(t => t.Status === DEFAULT_STATUS && isUnblocked(t, tasks))
    if (candidates.length > 0) {
      candidates.sort((a, b) => {
        const pa = PRIORITY_ORDER[a.Priority] ?? UNKNOWN_PRIORITY
        const pb = PRIORITY_ORDER[b.Priority] ?? UNKNOWN_PRIORITY
        return pa !== pb ? pa - pb : numericId(a.ID) - numericId(b.ID)
      })
      task = candidates[0]
      mark = true
    } else {
      // Crash resume: nothing else to do, continue the interrupted task.
      task = tasks.find(t => t.Status === IN_PROGRESS)
      if (!task) return noopResult()
    }
  }

  if (mark) {
    const rowIdx = findRowById(doc, task.ID)
    if (rowIdx === -1) return { ...noopResult(), warnings: [`[kanban-source] task ${task.ID} row not found`] }
    setCellText(doc.table.children[rowIdx].children[statusIdx], claimStatus)
    task = { ...task, Status: claimStatus }
  }
  return { messages: [], warnings: [], changed: mark, data: { task: toComposeTask(doc, task) } }
}

function opFinish(doc: BoardDoc, taskId: string, status: string, goalDir: string): OpResult {
  if (!doc.statuses.includes(status)) {
    return {
      ...noopResult(),
      warnings: [`[kanban-source] status "${status}" not in board legend; ${taskId} left unchanged`],
    }
  }
  const rowIdx = findRowById(doc, taskId)
  if (rowIdx === -1) return { ...noopResult(), warnings: [`[kanban-source] task ${taskId} not found`] }
  const row = doc.table.children[rowIdx]
  setCellText(row.children[headerIndex(doc, 'Status')], status)

  const planIdx = headerIndex(doc, 'Plan File')
  if (status === DEFAULT_MAP.FAILED && planIdx >= 0 && blank(toTasks(doc).find(t => t.ID === taskId)?.['Plan File'])) {
    setCellText(row.children[planIdx], path.join(goalDir, 'plan.md'))
  }
  return { messages: [], warnings: [], changed: true, data: null }
}

export function createKanbanSource(opts: KanbanSourceOptions): KanbanSource {
  const boardFile = path.resolve(opts.boardFile)
  const map: KanbanStatusMap = { ...DEFAULT_MAP, ...opts.statusMap }
  const log = opts.log ?? ((msg: string) => console.warn(msg))

  const claimWith = async (wantId?: string): Promise<ComposeTask | null> => {
    const r = await mutateBoard(boardFile, doc => opClaim(doc, map.claim, wantId))
    for (const w of r.warnings) log(w)
    const data = r.data as { task?: ComposeTask } | null
    return data?.task ?? null
  }

  return {
    boardFile,
    claim: () => claimWith(),
    claimId: id => claimWith(id),
    async onFinish(task, outcome, info) {
      if (outcome === 'FAILED') {
        await mkdir(info.goalDir, { recursive: true })
        await writeFile(
          path.join(info.goalDir, 'outcome.md'),
          `# ${task.id} — FAILED\n\nCompose run failed after round ${info.round}. See plan.md / verdict.md in this directory.\n`,
        )
      }
      const r = await mutateBoard(boardFile, doc => opFinish(doc, task.id, map[outcome], info.goalDir))
      for (const w of r.warnings) log(w)
    },
  }
}
