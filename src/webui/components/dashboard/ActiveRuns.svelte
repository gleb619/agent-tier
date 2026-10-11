<script lang="ts">
import Card from "$components/common/Card.svelte";
import RunItem from "$components/sidebar/RunItem.svelte";
import { activeRuns, selectRun } from "$stores/runs";
import { setCurrentView } from "$stores/ui";

function openRun(runId: string): void {
  selectRun(runId);
  setCurrentView("run-details");
}
</script>

<Card title="Active runs">
  {#if $activeRuns.length === 0}
    <p class="text-sm text-gray-500" data-testid="active-runs-empty">No active runs</p>
  {:else}
    <ul class="flex flex-col gap-1">
      {#each $activeRuns as run (run.runId)}
        <li>
          <RunItem {run} onSelect={() => openRun(run.runId)} />
        </li>
      {/each}
    </ul>
  {/if}
</Card>
