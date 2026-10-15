<script lang="ts">
import clsx from "clsx";
import { createEventDispatcher } from "svelte";

export let label: string;
export let checked = false;
export let disabled = false;

const dispatch = createEventDispatcher<{ change: boolean }>();

function onClick(): void {
  checked = !checked;
  // Consumers that need to persist the new state (e.g. the Agents view
  // calling the enable/disable API) listen for `change`; plain two-way
  // bindings (`bind:checked`) keep working as before.
  dispatch("change", checked);
}
</script>

<button
  type="button"
  role="switch"
  aria-checked={checked}
  aria-label={label}
  {disabled}
  class="inline-flex items-center gap-2 disabled:cursor-not-allowed disabled:opacity-50"
  on:click={onClick}
>
  <span
    class={clsx(
      "relative inline-flex h-5 w-9 items-center rounded-full transition-colors",
      checked ? "bg-primary-600" : "bg-gray-300",
    )}
  >
    <span
      class={clsx(
        "inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform",
        checked ? "translate-x-5" : "translate-x-1",
      )}
    ></span>
  </span>
  <span class="text-sm text-gray-700">{label}</span>
</button>
