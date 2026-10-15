export type ViewType = "dashboard" | "new-task" | "run-details" | "agents" | "settings";

export type RouteView = ViewType | "not-found";

export interface SSEEvent {
  type: string;
  // SSE payloads are agent-defined
  data: any;
  timestamp: Date;
}
