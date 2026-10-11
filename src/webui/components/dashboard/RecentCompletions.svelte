<script lang="ts">
import Card from "$components/common/Card.svelte";
import RunItem from "$components/sidebar/RunItem.svelte";
import { runs, selectRun } from "$stores/runs";
import { setCurrentView } from "$stores/ui";
import type { ApiRun } from "$types/api";

const MAX_ITEMS = 5;

function byFinishedAtDesc(a: ApiRun, b: ApiRun): number {
  return new Date(b.finishedAt ?? b.startedAt).getTime() - new Date(a.finishedAt ?? a.startedAt).getTime();
}

/** Newest finished runs (done or failed), live from the runs store. */
$: recent = $runs
  .filter((r) => r.status === "done" || r.status === "failed")
  .slice()
  .sort(byFinishedAtDesc)
  .slice(0, MAX_ITEMS);

function openRun(runId: string): void {
  selectRun(runId);
  setCurrentView("run-details");
}
</script>

<Card title="Recent completions">
  {#if recent.length === 0}
    <p class="text-sm text-gray-500" data-testid="recent-completions-empty">No completed runs yet</p>
  {:else}
    <ul class="flex flex-col gap-1">
      {#each recent as run (run.runId)}
        <li>
          <RunItem {run} onSelect={() => openRun(run.runId)} />
        </li>
      {/each}
    </ul>
  {/if}
</Card>
