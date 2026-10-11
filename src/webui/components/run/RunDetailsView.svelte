<script lang="ts">
import { onDestroy } from "svelte";
import Button from "$components/common/Button.svelte";
import Card from "$components/common/Card.svelte";
import { createRunDetailsSession, type RunDetailsSession } from "$stores/run-details";
import { selectedRun } from "$stores/runs";
import { showToast } from "$stores/toast";
import { deleteRun, retryRun } from "../../api/runs";
import DiscussPanel from "./DiscussPanel.svelte";
import LogViewer from "./LogViewer.svelte";
import RunMeta from "./RunMeta.svelte";

let session: RunDetailsSession | null = null;
let showPrompt = false;
let acting = false;

$: run = $selectedRun;
$: if (run && (!session || session.runId !== run.runId)) {
  session?.close();
  session = createRunDetailsSession(run.runId);
  showPrompt = false;
  void session.refresh().catch((err) => showToast(err instanceof Error ? err.message : String(err), "error"));
  session.start();
}

onDestroy(() => {
  window.removeEventListener("at:run-prompt", onShowPrompt);
  session?.close();
});

// Opened via the `p` keyboard shortcut. Registered at init (not onMount:
// lifecycle hooks are noop under the SSR-ish vitest runtime — see SettingsView).
function onShowPrompt(): void {
  if (run) showPrompt = true;
}

if (typeof window !== "undefined") {
  window.addEventListener("at:run-prompt", onShowPrompt);
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function retry(): Promise<void> {
  if (!run || acting) return;
  acting = true;
  try {
    await retryRun(run.runId);
    showToast("Retry started", "success");
  } catch (err) {
    showToast(errText(err), "error");
  } finally {
    acting = false;
  }
}

async function kill(): Promise<void> {
  if (!run || acting) return;
  if (!window.confirm(`Kill run ${run.runId}?`)) return;
  acting = true;
  try {
    await deleteRun(run.runId);
    showToast("Run killed", "success");
  } catch (err) {
    showToast(errText(err), "error");
  } finally {
    acting = false;
  }
}
</script>

{#if !run}
  <Card>
    <p class="text-sm text-gray-500" data-testid="no-run-selected">Select a run from the list to see its details.</p>
  </Card>
{:else}
  <div class="flex max-w-5xl flex-col gap-4" data-testid="run-details-view">
    <Card>
      <RunMeta {run} />
    </Card>

    <Card>
      <div class="flex flex-wrap items-center gap-2">
        <h3 class="text-sm font-semibold text-gray-900">Actions</h3>
        <div class="ml-auto flex gap-2">
          <Button
            label={acting ? "Working…" : "Retry"}
            size="sm"
            variant="secondary"
            disabled={acting}
            onClick={() => void retry()}
          />
          <Button label="Kill" size="sm" variant="danger" disabled={acting} onClick={() => void kill()} />
          <Button
            label={showPrompt ? "Hide prompt" : "Show prompt"}
            size="sm"
            variant="ghost"
            onClick={() => (showPrompt = !showPrompt)}
          />
        </div>
      </div>
      {#if showPrompt}
        <pre
          data-testid="run-prompt"
          class="mt-3 whitespace-pre-wrap rounded-md bg-gray-50 p-3 font-mono text-xs text-gray-800">{run.prompt}</pre>
      {/if}
    </Card>

    {#if session}
      <Card title="Log">
        <LogViewer {session} {run} />
      </Card>
      <Card title="Discuss">
        <DiscussPanel {session} {run} />
      </Card>
    {/if}
  </div>
{/if}
