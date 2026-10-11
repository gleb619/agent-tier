<script lang="ts">
import { filteredRuns } from "$stores/filters";
import { selectRun, selectedRunId } from "$stores/runs";
import { setCurrentView } from "$stores/ui";
import type { ApiRun } from "$types/api";
import { groupRunsByDate, type RunGroup } from "$utils/grouping";
import { layoutOffsets, virtualRange } from "$utils/virtual";
import FilterInput from "./FilterInput.svelte";
import RunItem from "./RunItem.svelte";

/** Switch to windowed rendering above this many rows. */
const VIRTUAL_THRESHOLD = 50;
const HEADER_HEIGHT = 28;
const ITEM_HEIGHT = 40;
/** Fallback viewport for the first paint (before any scroll event). */
const DEFAULT_VIEWPORT_HEIGHT = 600;

type Row = { kind: "header"; key: string; group: RunGroup } | { kind: "run"; key: string; run: ApiRun };

$: groups = groupRunsByDate($filteredRuns);
$: rows = groups.flatMap((group): Row[] => [
  { kind: "header", key: `header:${group.key}`, group },
  ...group.runs.map((run) => ({ kind: "run", key: run.runId, run }) as Row),
]);
$: heights = rows.map((row) => (row.kind === "header" ? HEADER_HEIGHT : ITEM_HEIGHT));
$: offsets = layoutOffsets(heights);
$: totalHeight = heights.reduce((sum, height) => sum + height, 0);
$: virtual = rows.length > VIRTUAL_THRESHOLD;

let scrollTop = 0;
let viewportHeight = 0;
$: range = virtual
  ? virtualRange(offsets, heights, scrollTop, viewportHeight || DEFAULT_VIEWPORT_HEIGHT)
  : { start: 0, end: rows.length };
$: visible = rows.slice(range.start, range.end).map((row, index) => ({ row, index: range.start + index }));

function onScroll(event: Event): void {
  const el = event.currentTarget as HTMLElement;
  scrollTop = el.scrollTop;
  viewportHeight = el.clientHeight;
}

function pick(run: ApiRun): void {
  selectRun(run.runId);
  setCurrentView("run-details");
}
</script>

<div class="flex h-full flex-col gap-2" data-testid="run-list">
  <FilterInput />
  {#if rows.length === 0}
    <p class="px-1 py-4 text-center text-sm text-gray-500" data-testid="run-list-empty">
      No runs match the current filter.
    </p>
  {:else if virtual}
    <div class="min-h-0 flex-1 overflow-y-auto" data-testid="run-list-scroll" on:scroll={onScroll}>
      <div class="relative" style="height: {totalHeight}px;">
        {#each visible as { row, index } (row.key)}
          <div class="absolute left-0 right-0" style="top: {offsets[index]}px;">
            {#if row.kind === "header"}
              <h3 class="px-1 pt-1 text-xs font-semibold uppercase tracking-wide text-gray-500" data-testid="group-header">
                {row.group.label}
              </h3>
            {:else}
              <RunItem run={row.run} selected={$selectedRunId === row.run.runId} onSelect={() => pick(row.run)} />
            {/if}
          </div>
        {/each}
      </div>
    </div>
  {:else}
    {#each groups as group (group.key)}
      <h3 class="px-1 pt-1 text-xs font-semibold uppercase tracking-wide text-gray-500" data-testid="group-header">
        {group.label}
      </h3>
      {#each group.runs as run (run.runId)}
        <RunItem run={run} selected={$selectedRunId === run.runId} onSelect={() => pick(run)} />
      {/each}
    {/each}
  {/if}
</div>
