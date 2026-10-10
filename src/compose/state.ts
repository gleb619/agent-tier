import type { ComposeWorkspace } from './workspace'

export type ComposePhase =
  | 'INVESTIGATE'
  | 'PLAN'
  | 'IMPLEMENT'
  | 'CHECK'
  | 'DONE'
  | 'FAILED'

export interface ComposeState {
  goal: string
  state: ComposePhase
  round: number
  testCmd: string
  maxRounds: number
}

export const STATE_FILE = 'state.json'

export const DEFAULT_TEST_CMD = 'npm test'
export const DEFAULT_MAX_ROUNDS = 3
export const DEFAULT_MAX_NODES = 30

export function createState(
  goal: string,
  opts: { testCmd?: string; maxRounds?: number } = {},
): ComposeState {
  return {
    goal,
    state: 'INVESTIGATE',
    round: 1,
    testCmd: opts.testCmd ?? DEFAULT_TEST_CMD,
    maxRounds: opts.maxRounds ?? DEFAULT_MAX_ROUNDS,
  }
}

export async function loadState(ws: ComposeWorkspace): Promise<ComposeState | null> {
  if (!(await ws.exists(STATE_FILE))) return null
  return JSON.parse(await ws.read(STATE_FILE)) as ComposeState
}

export async function saveState(ws: ComposeWorkspace, state: ComposeState): Promise<void> {
  await ws.write(STATE_FILE, JSON.stringify(state, null, 2) + '\n')
}
