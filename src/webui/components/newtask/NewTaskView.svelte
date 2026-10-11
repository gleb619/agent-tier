<script lang="ts">
import { onMount } from "svelte";
import { get } from "svelte/store";
import { listRuns, createRun } from "../../api/runs";
import { agents, refreshDashboard } from "$stores/dashboard";
import { runs, selectRun, setRuns } from "$stores/runs";
import { settings } from "$stores/settings";
import { showToast } from "$stores/toast";
import { setCurrentView } from "$stores/ui";
import {
  MAX_PROMPT_CHARS,
  MAX_RETRIES,
  RUN_MODES,
  buildCreateRunInput,
  clampRetries,
  isRunMode,
  validateNewTask,
} from "$utils/newtask";
import Button from "$components/common/Button.svelte";
import Card from "$components/common/Card.svelte";
import Input from "$components/common/Input.svelte";
import Select from "$components/common/Select.svelte";

// Defaults come from the settings store (plan step 4); read once at init.
let prompt = "";
let tier = String($settings.defaultTier);
let agent = $settings.defaultAgent;
let mode: string = isRunMode($settings.runMode) ? $settings.runMode : "stream";
let retries = String(clampRetries($settings.retries));
let error: string | null = null;
let submitting = false;

const tierOptions = [
  { value: "", label: "Auto (line order)" },
  ...[1, 2, 3, 4].map((n) => ({ value: String(n), label: `Tier ${n}` })),
];

$: agentOptions = [
  { value: "", label: "Auto (round-robin)" },
  ...$agents.map((a) => ({ value: a.name, label: `${a.name} (T${a.tier})` })),
];

const modeOptions = RUN_MODES.map((m) => ({ value: m, label: m }));

// Agent list is normally warm from the dashboard; fetch it if the view is entered first.
onMount(() => {
  if ($agents.length === 0) void refreshDashboard();
});

async function submit(): Promise<void> {
  if (submitting) return;
  const form = {
    prompt,
    tier: tier === "" ? null : Number(tier),
    agent,
    mode,
    retries: Number(retries),
  };
  error = validateNewTask(form, $agents.map((a) => a.name));
  if (error) return;

  submitting = true;
  try {
    await createRun(buildCreateRunInput(form));
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
    showToast(error, "error");
    return;
  } finally {
    submitting = false;
  }

  showToast("Run started", "success");
  prompt = "";
  // The new run appears in the run store on refetch; open it when visible.
  try {
    setRuns(await listRuns());
    const newest = get(runs)[0];
    if (newest) {
      selectRun(newest.runId);
      setCurrentView("run-details");
    } else {
      setCurrentView("dashboard");
    }
  } catch {
    setCurrentView("dashboard");
  }
}

function onPromptKeydown(event: KeyboardEvent): void {
  if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    void submit();
  }
}
</script>

<div class="max-w-2xl" data-testid="new-task-view">
  <Card>
    <div class="flex flex-col gap-4">
      <div class="flex flex-col gap-1">
        <div class="flex items-baseline justify-between">
          <label for="prompt" class="text-sm font-medium text-gray-700">Prompt</label>
          <span class="text-xs text-gray-400" data-testid="prompt-count">{prompt.length} / {MAX_PROMPT_CHARS}</span>
        </div>
        <textarea
          id="prompt"
          rows={8}
          maxlength={MAX_PROMPT_CHARS}
          placeholder="Describe the task… (Ctrl+Enter to submit)"
          bind:value={prompt}
          on:keydown={onPromptKeydown}
          class="rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
          data-testid="prompt-input"
        ></textarea>
      </div>

      <div class="grid gap-4 sm:grid-cols-2">
        <Select id="tier" label="Tier" bind:value={tier} options={tierOptions} disabled={submitting} />
        <Select id="agent" label="Agent" bind:value={agent} options={agentOptions} disabled={submitting} />
        <Select id="mode" label="Mode" bind:value={mode} options={modeOptions} disabled={submitting} />
        <Input id="retries" label="Retries" type="number" bind:value={retries} disabled={submitting} />
      </div>

      {#if error}
        <p role="alert" class="text-sm text-error-dark">{error}</p>
      {/if}

      <div class="flex items-center gap-3">
        <Button
          label={submitting ? "Starting…" : "Start run"}
          type="submit"
          disabled={submitting}
          onClick={() => void submit()}
        />
        <span class="text-xs text-gray-400">Retries: 0-{MAX_RETRIES}. Mode applies to future CLI runs.</span>
      </div>
    </div>
  </Card>
</div>
