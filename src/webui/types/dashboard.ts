/** Design-doc shape for dashboard statistics (kept for the scaffold contract). */
export interface DashboardStats {
  totalRuns: number;
  activeRuns: number;
  stuckRuns: number;
  todayRuns: number;
  successRate: number; // percentage
  avgDuration: number; // in seconds
}

/** One tile of the dashboard QuickStats grid (derived from ApiStats). */
export interface DashboardStat {
  label: string;
  value: string;
  tone: "default" | "info" | "success" | "warning" | "danger";
}
