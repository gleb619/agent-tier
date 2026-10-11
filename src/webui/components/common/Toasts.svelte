<script lang="ts">
import clsx from "clsx";
import { dismissToast, toasts } from "$stores/toast";

const kinds: Record<string, string> = {
  info: "border-gray-300 bg-white text-gray-700",
  success: "border-green-300 bg-green-50 text-green-800",
  error: "border-red-300 bg-red-50 text-red-800",
};
</script>

{#if $toasts.length > 0}
  <div class="fixed bottom-4 right-4 z-50 flex flex-col gap-2" data-testid="toasts">
    {#each $toasts as toast (toast.id)}
      <div
        role="status"
        class={clsx("flex max-w-xs items-start justify-between gap-3 rounded-md border px-3 py-2 text-sm shadow-lg", kinds[toast.kind])}
        data-testid="toast"
      >
        <span>{toast.message}</span>
        <button
          type="button"
          aria-label="Dismiss"
          class="text-gray-400 hover:text-gray-600"
          on:click={() => dismissToast(toast.id)}
        >
          ✕
        </button>
      </div>
    {/each}
  </div>
{/if}
