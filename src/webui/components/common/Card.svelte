<script lang="ts">
export let title: string | undefined = undefined;
</script>

<div class="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
  {#if title}
    <h2 class="mb-3 text-sm font-semibold text-gray-900">{title}</h2>
  {/if}
  <slot />
</div>
