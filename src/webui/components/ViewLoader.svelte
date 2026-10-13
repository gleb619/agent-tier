<script lang="ts">
import Skeleton from "$components/common/Skeleton.svelte";
import NotFoundView from "$components/NotFoundView.svelte";
import { currentView } from "$stores/ui";
import type { ViewType } from "$types/index";
import { viewModules } from "$utils/router";

$: view = $currentView;
$: loader = view === "not-found" ? null : viewModules[view as ViewType];
</script>

{#if view === "not-found"}
  <NotFoundView />
{:else if loader}
  {#await loader()}
    <div class="mt-4">
      <Skeleton lines={6} />
    </div>
  {:then mod}
    <svelte:component this={mod.default} />
  {:catch err}
    <div
      role="alert"
      class="mt-4 rounded-md border border-error-200 bg-error-50 p-4 text-sm text-error-dark"
    >
      Failed to load view: {err instanceof Error ? err.message : String(err)}
    </div>
  {/await}
{/if}
