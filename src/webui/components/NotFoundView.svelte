<script lang="ts">
import Button from "$components/common/Button.svelte";
import { navigateTo } from "$utils/router";
</script>

<div class="flex max-w-xl flex-col gap-4" data-testid="not-found-view">
  <h2 class="text-lg font-semibold text-gray-900">404 — Not Found</h2>
  <p class="text-sm text-gray-600">This page does not exist.</p>
  <div>
    <Button label="Go to Dashboard" onClick={() => navigateTo("dashboard")} />
  </div>
</div>
