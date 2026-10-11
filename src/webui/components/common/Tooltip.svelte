<script lang="ts">
export let text: string;
</script>

<span class="group relative inline-flex">
  <slot />
  <span
    role="tooltip"
    class="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 -translate-x-1/2 whitespace-nowrap rounded-md bg-gray-900 px-2 py-1 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100"
  >
    {text}
  </span>
</span>
