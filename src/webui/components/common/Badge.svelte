<script lang="ts">
import clsx from "clsx";

export let color: "gray" | "blue" | "green" | "red" | "yellow" = "gray";
export let text: string;

const colors: Record<string, string> = {
  gray: "bg-gray-100 text-gray-700",
  blue: "bg-primary-100 text-primary-700",
  green: "bg-green-100 text-green-700",
  red: "bg-error-light text-error-dark",
  yellow: "bg-yellow-100 text-yellow-700",
};
</script>

<span class={clsx("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium", colors[color])}>
  {text}
</span>
