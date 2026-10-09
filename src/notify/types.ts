export type NotifyEventType = 'start' | 'message' | 'tool' | 'progress' | 'error' | 'done';

export interface NotifyEvent {
  runId: string;
  agent: string;
  ts: string;
  seq: number;
  type: NotifyEventType;
  text?: string;
  data?: Record<string, unknown>;
}

export interface NotifyAdapterContext {
  runId: string;
  port?: number;
  eventFile: string;
}

export interface NotifyAdapter {
  name: string;
  args?(ctx: NotifyAdapterContext): string[];
  env?(ctx: NotifyAdapterContext): Record<string, string>;
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
