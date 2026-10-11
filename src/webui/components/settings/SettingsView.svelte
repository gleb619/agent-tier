<script lang="ts">
import { agents, refreshDashboard } from "$stores/dashboard";
import { DEFAULT_SETTINGS, loadSettings, saveSettings, settings } from "$stores/settings";
import { showToast } from "$stores/toast";
import { MAX_RETRIES, RUN_MODES } from "$utils/newtask";
import {
  MAX_SSE_PORT,
  extraSettingsEntries,
  formFromSettings,
  settingsPatchFromForm,
  validateSettingsForm,
  type SettingsForm,
  type SettingsFormErrors,
} from "$utils/settings";
import Button from "$components/common/Button.svelte";
import Card from "$components/common/Card.svelte";
import Input from "$components/common/Input.svelte";
import Select from "$components/common/Select.svelte";
import Toggle from "$components/common/Toggle.svelte";

// Local editable mirror; re-initialized from the backend once settings load.
let form: SettingsForm = formFromSettings(DEFAULT_SETTINGS);
let saving = false;

$: knownAgentNames = $agents.map((a) => a.name);
// Live inline validation on every edit.
$: errors = validateSettingsForm(form, knownAgentNames) as SettingsFormErrors;
$: agentOptions = [
  { value: "", label: "Auto (round-robin)" },
  ...$agents.map((a) => ({ value: a.name, label: `${a.name} (T${a.tier})` })),
];
$: extras = extraSettingsEntries($settings);

const tierOptions = [1, 2, 3, 4].map((n) => ({ value: String(n), label: `Tier ${n}` }));
const modeOptions = RUN_MODES.map((m) => ({ value: m, label: m }));

// Load at init (not onMount: noop under the SSR-ish vitest runtime) and
// re-initialize the form once the backend settings arrive.
if ($agents.length === 0) void refreshDashboard();
void loadSettings().then(() => {
  form = formFromSettings($settings);
});

async function save(): Promise<void> {
  if (saving) return;
  if (Object.keys(errors).length > 0) return;
  saving = true;
  try {
    await saveSettings(settingsPatchFromForm(form));
    showToast("Settings saved", "success");
  } catch (err) {
    showToast(err instanceof Error ? err.message : String(err), "error");
  } finally {
    saving = false;
  }
}
</script>

<div class="flex max-w-2xl flex-col gap-4" data-testid="settings-view">
  <Card>
    <div class="flex flex-col gap-4">
      <h3 class="text-sm font-semibold text-gray-900">Defaults</h3>
      <div class="grid gap-4 sm:grid-cols-2">
        <div>
          <Select id="default-tier" label="Tier" bind:value={form.defaultTier} options={tierOptions} disabled={saving} />
          {#if errors.defaultTier}
            <p role="alert" class="mt-1 text-xs text-error-dark">{errors.defaultTier}</p>
          {/if}
        </div>
        <div>
          <Select id="default-agent" label="Agent" bind:value={form.defaultAgent} options={agentOptions} disabled={saving} />
          {#if errors.defaultAgent}
            <p role="alert" class="mt-1 text-xs text-error-dark">{errors.defaultAgent}</p>
          {/if}
        </div>
        <div>
          <Select id="default-mode" label="Mode" bind:value={form.runMode} options={modeOptions} disabled={saving} />
          {#if errors.runMode}
            <p role="alert" class="mt-1 text-xs text-error-dark">{errors.runMode}</p>
          {/if}
        </div>
        <div>
          <Input id="default-retries" label="Retries" type="number" bind:value={form.retries} disabled={saving} />
          {#if errors.retries}
            <p role="alert" class="mt-1 text-xs text-error-dark">{errors.retries}</p>
          {/if}
        </div>
      </div>
      <Toggle label="Auto-refresh" bind:checked={form.autoRefresh} disabled={saving} />
    </div>
  </Card>

  <Card>
    <div class="flex flex-col gap-4">
      <h3 class="text-sm font-semibold text-gray-900">Advanced</h3>
      <div class="grid gap-4 sm:grid-cols-2">
        <div>
          <Input id="sse-port" label="SSE port" type="number" bind:value={form.ssePort} disabled={saving} />
          {#if errors.ssePort}
            <p role="alert" class="mt-1 text-xs text-error-dark">{errors.ssePort}</p>
          {/if}
        </div>
        <div>
          <Input id="log-dir" label="Log dir" bind:value={form.logDir} placeholder="~/.at/logs" disabled={saving} />
        </div>
        <div>
          <Input id="state-dir" label="State dir" bind:value={form.stateDir} placeholder="~/.at" disabled={saving} />
        </div>
      </div>
      <p class="text-xs text-gray-500">SSE port: 1-{MAX_SSE_PORT}. Empty advanced fields clear the stored value.</p>
    </div>
  </Card>

  {#if extras.length > 0}
    <Card>
      <div class="flex flex-col gap-2">
        <h3 class="text-sm font-semibold text-gray-900">Other stored settings</h3>
        <p class="text-xs text-gray-500">Read-only keys written by other clients (e.g. state/config paths).</p>
        <dl class="flex flex-col gap-1">
          {#each extras as [key, value] (key)}
            <div class="flex items-baseline gap-2 text-sm" data-testid="settings-extra">
              <dt class="shrink-0 font-medium text-gray-700">{key}</dt>
              <dd class="break-all text-gray-500">{value}</dd>
            </div>
          {/each}
        </dl>
      </div>
    </Card>
  {/if}

  <div class="flex items-center gap-3">
    <Button label={saving ? "Saving…" : "Save settings"} type="submit" disabled={saving} onClick={() => void save()} />
    <span class="text-xs text-gray-500">Defaults are used by New Task. Retries: 0-{MAX_RETRIES}.</span>
  </div>
</div>
