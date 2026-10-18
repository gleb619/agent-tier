<script lang="ts">
import clsx from "clsx";
import Card from "$components/common/Card.svelte";
import { usage } from "$stores/usage";
import { BUDGET_CLASS, deriveUsageTiles, formatDuration, variancePct } from "$utils/usage";

$: tiles = $usage ? deriveUsageTiles($usage.summary) : [];
$: worst = ($usage?.budgets ?? []).filter((b) => b.timeState === "over").slice(0, 5);
</script>

<Card title="Time">
  {#if !$usage}
    <p class="text-sm text-gray-500" data-testid="usage-empty">No usage data yet</p>
  {:else}
    <dl class="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
      {#each tiles as tile (tile.label)}
        <div class="rounded-md border border-gray-100 bg-gray-50 p-3" data-testid="usage-tile">
          <dt class="text-xs text-gray-500">{tile.label}</dt>
          <dd class={clsx("mt-1 text-2xl font-semibold tabular-nums", BUDGET_CLASS[tile.tone])}>{tile.value}</dd>
          {#if tile.hint}<p class="mt-0.5 text-xs text-gray-500">{tile.hint}</p>{/if}
        </div>
      {/each}
    </dl>
    {#if worst.length > 0}
      <ul class="mt-3 space-y-1 text-sm" data-testid="usage-over-budget">
        {#each worst as b (b.taskId)}
          <li class="flex flex-wrap gap-x-3">
            <span class="font-mono">{b.taskId}</span>
            <span class="truncate text-gray-600">{b.title}</span>
            <span class={clsx("tabular-nums", BUDGET_CLASS[b.timeState])}>
              {formatDuration(b.actualMs)} / {b.estMs === null ? "—" : formatDuration(b.estMs)} ({variancePct(b.estMs, b.actualMs)})
            </span>
          </li>
        {/each}
      </ul>
    {/if}
  {/if}
</Card>
