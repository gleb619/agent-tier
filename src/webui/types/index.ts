export type ViewType = "dashboard" | "new-task" | "run-details" | "settings";

export interface SSEEvent {
  type: string;
  // SSE payloads are agent-defined
  data: any;
  timestamp: Date;
}
