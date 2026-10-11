<script lang="ts">
import clsx from "clsx";

export let label: string;
export let variant: "primary" | "secondary" | "ghost" | "danger" = "primary";
export let size: "sm" | "md" = "md";
export let disabled = false;
export let type: "button" | "submit" = "button";
export let onClick: (() => void) | undefined = undefined;

const base =
  "inline-flex items-center justify-center rounded-md font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 disabled:cursor-not-allowed disabled:opacity-50";
const variants: Record<string, string> = {
  primary: "bg-primary-600 text-white hover:bg-primary-700",
  secondary: "border border-gray-300 bg-white text-gray-700 hover:bg-gray-50",
  ghost: "text-gray-600 hover:bg-gray-100 hover:text-gray-900",
  danger: "bg-error text-white hover:bg-error-dark",
};
const sizes: Record<string, string> = {
  sm: "px-2 py-1 text-xs",
  md: "px-3 py-1.5 text-sm",
};
</script>

<button {type} {disabled} class={clsx(base, variants[variant], sizes[size])} on:click={onClick}>
  {label}
</button>
