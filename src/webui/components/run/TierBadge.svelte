<script lang="ts">
import clsx from "clsx";

export let tier: number;

const colors: Record<number, string> = {
  1: "bg-purple-100 text-purple-700",
  2: "bg-primary-100 text-primary-700",
  3: "bg-yellow-100 text-yellow-700",
  4: "bg-gray-100 text-gray-700",
};
</script>

<span class={clsx("inline-flex rounded px-1.5 py-0.5 text-xs font-semibold", colors[tier] ?? colors[4])}>
  T{tier}
</span>
