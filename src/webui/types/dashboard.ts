export interface DashboardStats {
  totalRuns: number;
  activeRuns: number;
  stuckRuns: number;
  todayRuns: number;
  successRate: number; // percentage
  avgDuration: number; // in seconds
}
