export type NotifyEventType =
  | 'start'
  | 'message'
  | 'tool'
  | 'progress'
  | 'error'
  | 'done'
  | 'question'
  | 'answer'
  | 'rename';

export type DiscussFrom = 'agent' | 'host';
export type DiscussKind = 'question' | 'answer' | 'say' | 'note';

/** A single entry in the per-run discussion thread (`<stateDir>/events/<runId>.discuss.jsonl`). */
export interface DiscussEntry {
  id: string;
  from: DiscussFrom;
  kind: DiscussKind;
  text: string;
  options?: string[];
  replyTo?: string;
  ts: string;
}

/** Payload of a 'question' NotifyEvent emitted by `at discuss ask`. */
export interface DiscussQuestionPayload {
  id: string;
  text: string;
  options?: string[];
}

/** Payload of an 'answer' NotifyEvent. */
export interface DiscussAnswerPayload {
  qid: string;
  answer: string;
}

export interface NotifyEvent {
  runId: string;
  agent: string;
  ts: string;
  seq: number;
  type: NotifyEventType;
  text?: string;
  data?: Record<string, unknown>;
}

/** Payload of a 'question' event emitted by `at ask`. */
export interface QuestionPayload {
  id: string;
  text: string;
  options?: string[];
}

/** Payload of an 'answer' event emitted by `at answer` / hub /answer. */
export interface AnswerPayload {
  qid: string;
  answer: string;
}

/** A single entry appended to `<stateDir>/events/<runId>.answers.jsonl`. */
export interface AnswerRecord {
  qid: string;
  answer: string;
  ts: string;
}

export interface NotifyAdapterContext {
  runId: string;
  port?: number;
  eventFile: string;
  /**
   * Shell-quoted `node /abs/path/to/cli.js` — exposed to agents so the
   * prompt suffix can inline the absolute path (some agents run their tool
   * subprocesses inside a daemon that strips `AT_BIN` from the env). Only
   * populated by the SSE path; non-SSE callers pass undefined.
   */
  atBin?: string;
  /**
   * The `at` state directory for this run, exposed so adapters can inline
   * `--state-dir <dir>` in prompt instructions. The runner sets
   * `AT_STATE_DIR` for the child, but subprocesses inside the agent's
   * daemon (cline v3 hub, ...) may not inherit it. Only set on SSE path.
   */
  stateDir?: string;
  /**
   * The agent's working directory for this run, exposed so adapters can
   * point the LLM at a per-run helper script (e.g. cline's host-channel
   * shim that sets the right env regardless of the daemon's stale one).
   */
  cwd?: string;
  /**
   * Absolute path of a per-run helper script the runner drops in `cwd`
   * for the agent. The cline adapter inlines this into the prompt suffix
   * so the LLM has a single, deterministic way to reach the host
   * channel without trusting the agent-daemon's env.
   */
  hostChannelShim?: string;
}

export interface NotifyAdapter {
  name: string;
  args?(ctx: NotifyAdapterContext): string[];
  env?(ctx: NotifyAdapterContext): Record<string, string>;
  promptPrefix?(ctx: NotifyAdapterContext): string;
  promptSuffix?(ctx: NotifyAdapterContext): string;
  /**
   * Optional: take the agent's full base args (with prompt already appended)
   * and return a new argv array with structured-output flags inserted at the
   * correct position. Defaults to appending `args()` to the end.
   */
  transformArgs?(ctx: NotifyAdapterContext, baseArgs: string[]): string[];
  parseLine?(line: string): Array<Omit<NotifyEvent, 'runId' | 'agent' | 'ts' | 'seq'>>;
  flush?(): Array<Omit<NotifyEvent, 'runId' | 'agent' | 'ts' | 'seq'>>;
}
