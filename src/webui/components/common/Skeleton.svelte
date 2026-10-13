<script lang="ts">
export let lines = 4;
</script>

<div aria-busy="true" aria-label="Loading view" data-testid="skeleton">
  {#each Array(lines) as _, i (i)}
    <div class="mb-3 h-4 animate-pulse rounded bg-gray-200 last:mb-0"></div>
  {/each}
</div>
