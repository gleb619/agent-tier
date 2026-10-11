<script lang="ts">
import { getRunDiscuss, postRunDiscuss } from "../../api/runs";
import Button from "$components/common/Button.svelte";
import type { RunDetailsSession } from "$stores/run-details";
import { showToast } from "$stores/toast";
import type { ApiDiscussEntry, ApiRun } from "$types/api";

export let session: RunDetailsSession;
export let run: ApiRun;

const lastEvent = session.lastEvent;

let pending: ApiDiscussEntry[] = [];
let answers: Record<string, string> = {};
let loading = true;
let posting: string | null = null;
let seenEvent: unknown = null;
let loadedFor: string | null = null;

async function loadPending(): Promise<void> {
  try {
    pending = await getRunDiscuss(run.runId, true);
  } catch (err) {
    showToast(err instanceof Error ? err.message : String(err), "error");
  } finally {
    loading = false;
  }
}

// Initial load (and run switch) — reactive because lifecycle callbacks are a
// no-op under the vitest/jsdom test setup, same pattern as DashboardView.
$: if (run.runId !== loadedFor) {
  loadedFor = run.runId;
  void loadPending();
}

// A question/answer landing on the run's SSE stream refreshes the list.
$: if ($lastEvent !== seenEvent) {
  seenEvent = $lastEvent;
  if ($lastEvent && ($lastEvent.type === "question" || $lastEvent.type === "answer")) {
    void loadPending();
  }
}

async function answer(question: ApiDiscussEntry, text: string): Promise<void> {
  const value = text.trim();
  if (!value || posting) return;
  posting = question.id;
  try {
    await postRunDiscuss(run.runId, { kind: "answer", text: value, replyTo: question.id });
    answers = { ...answers, [question.id]: "" };
    showToast("Answer sent", "success");
    await loadPending();
  } catch (err) {
    showToast(err instanceof Error ? err.message : String(err), "error");
  } finally {
    posting = null;
  }
}
</script>

<div class="flex flex-col gap-3" data-testid="discuss-panel">
  {#if loading}
    <p class="text-sm text-gray-500">Loading questions…</p>
  {:else if pending.length === 0}
    <p class="text-sm text-gray-500" data-testid="discuss-empty">No pending questions.</p>
  {:else}
    {#each pending as question (question.id)}
      <div class="rounded-md border border-yellow-200 bg-yellow-50 p-3" data-testid="discuss-question">
        <p class="text-sm font-medium text-gray-900">{question.text}</p>
        {#if question.options?.length}
          <div class="mt-2 flex flex-wrap gap-2">
            {#each question.options as option (option)}
              <Button
                label={option}
                size="sm"
                variant="secondary"
                disabled={posting === question.id}
                onClick={() => void answer(question, option)}
              />
            {/each}
          </div>
        {/if}
        <div class="mt-2 flex gap-2">
          <input
            type="text"
            aria-label="Answer to {question.id}"
            placeholder="Answer…"
            bind:value={answers[question.id]}
            on:keydown={(e) => e.key === "Enter" && void answer(question, answers[question.id] ?? "")}
            class="flex-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
          />
          <Button
            label={posting === question.id ? "Sending…" : "Send"}
            size="sm"
            disabled={posting === question.id}
            onClick={() => void answer(question, answers[question.id] ?? "")}
          />
        </div>
      </div>
    {/each}
  {/if}
</div>
