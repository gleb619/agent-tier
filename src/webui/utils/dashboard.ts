import type { ApiStats } from "$types/api";
import type { DashboardStat } from "$types/dashboard";

/**
 * Derive the QuickStats tiles from `GET /api/stats` (web-server/internal/api).
 * Pure view-model mapping — no extra fetching.
 */
export function deriveDashboardStats(stats: ApiStats): DashboardStat[] {
  const finished = stats.done + stats.failed;
  const successRate = finished === 0 ? "—" : `${Math.round((stats.done / finished) * 100)}%`;
  const activeAgents = stats.agents.total - stats.agents.deactivated;
  return [
    { label: "Total runs", value: String(stats.total), tone: "default" },
    { label: "Running", value: String(stats.running), tone: stats.running > 0 ? "info" : "default" },
    { label: "Done", value: String(stats.done), tone: "success" },
    { label: "Failed", value: String(stats.failed), tone: stats.failed > 0 ? "danger" : "default" },
    { label: "Stuck", value: String(stats.stuck), tone: stats.stuck > 0 ? "warning" : "default" },
    { label: "Success rate", value: successRate, tone: "default" },
    { label: "Agents", value: `${activeAgents}/${stats.agents.total}`, tone: "default" },
  ];
}
