<script lang="ts">
import clsx from "clsx";

export let name: string;
export let enabled = true;
</script>

<span
  class={clsx(
    "inline-flex items-center gap-1 rounded bg-gray-100 px-1.5 py-0.5 font-mono text-xs text-gray-700",
    !enabled && "opacity-50 line-through",
  )}
  title={enabled ? name : `${name} (disabled)`}
>
  <span class={clsx("h-1.5 w-1.5 rounded-full", enabled ? "bg-success" : "bg-gray-400")}></span>
  {name}
</span>
