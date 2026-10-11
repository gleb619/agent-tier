<script lang="ts">
import { afterUpdate } from "svelte";
import Button from "$components/common/Button.svelte";
import type { RunDetailsSession } from "$stores/run-details";
import { showToast } from "$stores/toast";
import type { ApiRun } from "$types/api";
import { filterLines, findMatches, splitHighlight, stepMatch } from "$utils/log";
import { layoutOffsets, virtualRange } from "$utils/virtual";

export let session: RunDetailsSession;
export let run: ApiRun;

const lines = session.lines;
const ROW_H = 20; // leading-5
const OVERSCAN = 8;
/** Viewport fallback for tests (jsdom reports 0) and pre-layout frames. */
const FALLBACK_VIEWPORT_H = 400;

let query = "";
let follow = true;
let activeLine: number | null = null;
let container: HTMLDivElement | null = null;
let viewportH = 0;
let scrollTop = 0;

$: visible = filterLines($lines, query);
$: heights = visible.map(() => ROW_H);
$: offsets = layoutOffsets(heights);
$: range = virtualRange(offsets, heights, scrollTop, viewportH || FALLBACK_VIEWPORT_H, OVERSCAN);
$: rendered = visible.slice(range.start, range.end);
$: matchIndexes = findMatches(visible, query);
$: matchLines = matchIndexes.map((i) => visible[i]!.n);
$: matchPosition = activeLine !== null && matchLines.includes(activeLine) ? matchLines.indexOf(activeLine) + 1 : matchLines.length > 0 ? 1 : 0;
$: totalHeight = offsets.length > 0 ? offsets[offsets.length - 1]! + ROW_H : 0;

// Pin to the bottom on new lines while following; user scroll-up unfollows.
// (afterUpdate keeps this out of the reactive graph so a jsdom scroll event
// cannot feed back into the `$lines`-dependent block above.)
let prevLineCount = 0;
afterUpdate(() => {
  if (follow && container && $lines.length !== prevLineCount) {
    prevLineCount = $lines.length;
    container.scrollTop = container.scrollHeight;
  }
});

function onScroll(): void {
  if (!container) return;
  scrollTop = container.scrollTop;
  follow = container.scrollTop + container.clientHeight >= container.scrollHeight - ROW_H;
}

function scrollToIndex(index: number): void {
  if (!container || index < 0 || index >= offsets.length) return;
  follow = false;
  container.scrollTop = offsets[index]!;
}

function gotoMatch(direction: 1 | -1): void {
  const next = stepMatch(matchLines, activeLine, direction);
  if (next === null) return;
  activeLine = next;
  scrollToIndex(visible.findIndex((l) => l.n === next));
}

function logText(): string {
  return $lines.map((l) => l.text).join("\n");
}

async function copyLog(): Promise<void> {
  try {
    await navigator.clipboard.writeText(logText());
    showToast(`Copied ${$lines.length} log lines`, "success");
  } catch {
    showToast("Copy failed", "error");
  }
}

function downloadLog(): void {
  try {
    const blob = new Blob([logText()], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${run.runId}.log`;
    anchor.click();
    URL.revokeObjectURL(url);
    showToast("Log download started", "success");
  } catch {
    showToast("Download failed", "error");
  }
}
</script>

<div class="flex flex-col gap-2" data-testid="log-viewer">
  <div class="flex flex-wrap items-center gap-2">
    <input
      type="search"
      aria-label="Search log"
      placeholder="Search / filter…"
      bind:value={query}
      data-testid="log-search"
      class="w-56 rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
    />
    <span class="text-xs tabular-nums text-gray-500" data-testid="match-count">
      {matchPosition} / {matchLines.length}
    </span>
    <Button label="↑" size="sm" variant="ghost" disabled={matchLines.length === 0} onClick={() => gotoMatch(-1)} />
    <Button label="↓" size="sm" variant="ghost" disabled={matchLines.length === 0} onClick={() => gotoMatch(1)} />
    <span class="ml-auto flex gap-2">
      <Button label="Copy" size="sm" variant="secondary" disabled={$lines.length === 0} onClick={() => void copyLog()} />
      <Button label="Download" size="sm" variant="secondary" disabled={$lines.length === 0} onClick={downloadLog} />
    </span>
  </div>

  {#if $lines.length === 0}
    <p class="rounded-md border border-dashed border-gray-300 p-4 text-sm text-gray-500" data-testid="log-empty">
      No log output yet.
    </p>
  {:else}
    <div
      bind:this={container}
      bind:clientHeight={viewportH}
      on:scroll={onScroll}
      data-testid="log-container"
      class="h-96 overflow-y-auto rounded-md border border-gray-200 bg-gray-900 py-1 font-mono text-xs text-gray-100"
    >
      <div class="relative" style:height="{totalHeight}px">
        {#each rendered as line, i (line.n)}
          {@const top = offsets[range.start + i] ?? 0}
          <div
            class="absolute left-0 flex w-full items-start px-2 leading-5"
            class:bg-gray-800={line.n === activeLine}
            style:top="{top}px"
            data-line={line.n}
          >
            <span class="w-10 shrink-0 select-none pr-2 text-right text-gray-500">{line.n}</span>
            <span class="break-all whitespace-pre-wrap">
              {#each splitHighlight(line.text, query) as segment, si (si)}
                <span class="mark" class:bg-amber-300={segment.match} class:text-gray-900={segment.match}
                  >{segment.text}</span
                >
              {/each}
            </span>
          </div>
        {/each}
      </div>
    </div>
  {/if}
</div>
