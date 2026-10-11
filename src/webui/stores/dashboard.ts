import { writable } from "svelte/store";
import { api } from "../api/client";
import type { ApiAgent, ApiStats } from "$types/api";

/** Latest `GET /api/stats` payload (null until the first successful fetch). */
export const stats = writable<ApiStats | null>(null);
/** Latest `GET /api/agents` payload. */
export const agents = writable<ApiAgent[]>([]);
/** Set when the last refresh failed; cleared on success. */
export const dashboardError = writable<string | null>(null);

/** Fetch stats + agents in parallel; failures land in dashboardError. */
export async function refreshDashboard(): Promise<void> {
  try {
    const [nextStats, nextAgents] = await Promise.all([api.getStats(), api.getAgents()]);
    stats.set(nextStats);
    agents.set(nextAgents);
    dashboardError.set(null);
  } catch (err) {
    dashboardError.set(err instanceof Error ? err.message : String(err));
  }
}
