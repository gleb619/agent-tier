export interface Settings {
  defaultTier: number;
  defaultAgent: string;
  runMode: "stream" | "block" | "detached";
  retries: number;
  autoRefresh: boolean;
  ssePort?: number;
  logDir?: string;
  stateDir?: string;
}
