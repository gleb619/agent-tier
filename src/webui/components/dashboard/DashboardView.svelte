<script lang="ts">
import { onMount } from "svelte";
import { agents, dashboardError, refreshDashboard, stats } from "$stores/dashboard";
import { lastEventTime } from "$stores/sse";
import ActiveRuns from "./ActiveRuns.svelte";
import AgentsPanel from "./AgentsPanel.svelte";
import QuickStats from "./QuickStats.svelte";
import RecentCompletions from "./RecentCompletions.svelte";

/** Min interval between SSE-triggered refetches (hub events can be bursty). */
const REFETCH_THROTTLE_MS = 2000;

let lastRefresh = 0;

async function refreshIfStale(force = false): Promise<void> {
  const now = Date.now();
  if (!force && now - lastRefresh < REFETCH_THROTTLE_MS) return;
  lastRefresh = now;
  await refreshDashboard();
}

onMount(() => {
  void refreshIfStale(true);
});

// Live via the SSE store: every hub event bumps lastEventTime → throttled refetch.
$: if ($lastEventTime) void refreshIfStale();
</script>

<div class="flex flex-col gap-4" data-testid="dashboard-view">
  {#if $stats}
    <QuickStats stats={$stats} />
  {:else if $dashboardError}
    <p role="alert" class="text-sm text-error-dark">Failed to load dashboard: {$dashboardError}</p>
  {:else}
    <p class="text-sm text-gray-500">Loading dashboard…</p>
  {/if}

  <div class="grid gap-4 lg:grid-cols-2">
    <ActiveRuns />
    <RecentCompletions />
  </div>

  <AgentsPanel agents={$agents} />
</div>
