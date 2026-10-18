/** Time estimation calibrated from history. Pure; no I/O. */

export interface CalibrationSample {
  plannedMs: number;
  actualMs: number;
}

/** Fewer finished tasks than this and the ratio is noise: trust the plan as written. */
export const MIN_SAMPLES = 3;
const MIN_FACTOR = 0.25;
const MAX_FACTOR = 4;

/** Median actual/planned over finished tasks, clamped; 1 without enough history. */
export function calibrationFactor(samples: CalibrationSample[]): number {
  const ratios = samples
    .filter((s) => s.plannedMs > 0 && s.actualMs > 0)
    .map((s) => s.actualMs / s.plannedMs)
    .sort((a, b) => a - b);
  if (ratios.length < MIN_SAMPLES) return 1;
  const mid = Math.floor(ratios.length / 2);
  const median = ratios.length % 2 ? ratios[mid] : (ratios[mid - 1] + ratios[mid]) / 2;
  return Math.min(MAX_FACTOR, Math.max(MIN_FACTOR, median));
}

/** Estimated wall time = planned × calibration, rounded to whole seconds. */
export function estimateMs(plannedMs: number, factor: number): number {
  return Math.round((plannedMs * factor) / 1000) * 1000;
}

/** ms → editable duration text (`1h30m`, `45m`, `90s`) that `parseDuration` reads back exactly. */
export function toDurationText(ms: number): string {
  let s = Math.max(1, Math.round(ms / 1000));
  const parts: string[] = [];
  for (const [unit, size] of [
    ["d", 86_400],
    ["h", 3600],
    ["m", 60],
    ["s", 1],
  ] as const) {
    const n = Math.floor(s / size);
    if (n > 0) parts.push(`${n}${unit}`);
    s -= n * size;
  }
  return parts.join("");
}
