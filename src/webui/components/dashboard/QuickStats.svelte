<script lang="ts">
import clsx from "clsx";
import Card from "$components/common/Card.svelte";
import type { ApiStats } from "$types/api";
import { deriveDashboardStats } from "$utils/dashboard";

export let stats: ApiStats;

const TONE_CLASS: Record<string, string> = {
  default: "text-gray-900",
  info: "text-primary-600",
  success: "text-success-dark",
  warning: "text-yellow-600",
  danger: "text-error-dark",
};

$: items = deriveDashboardStats(stats);
</script>

<Card title="Overview">
  <dl class="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
    {#each items as item (item.label)}
      <div class="rounded-md border border-gray-100 bg-gray-50 p-3" data-testid="stat-tile">
        <dt class="text-xs text-gray-500">{item.label}</dt>
        <dd class={clsx("mt-1 text-2xl font-semibold tabular-nums", TONE_CLASS[item.tone])}>{item.value}</dd>
      </div>
    {/each}
  </dl>
</Card>
