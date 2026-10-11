/** Prefix offsets for rows of the given heights: offsets[i] = top of row i in scroll content. */
export function layoutOffsets(heights: number[]): number[] {
  const offsets: number[] = [];
  let acc = 0;
  for (const h of heights) {
    offsets.push(acc);
    acc += h;
  }
  return offsets;
}

/**
 * Visible row range for a scroll position: every row intersecting
 * [scrollTop, scrollTop + viewportHeight], widened by `overscan` rows per side
 * and clamped to the list. Returns start (inclusive) and end (exclusive).
 */
export function virtualRange(
  offsets: number[],
  heights: number[],
  scrollTop: number,
  viewportHeight: number,
  overscan = 5,
): { start: number; end: number } {
  const count = offsets.length;
  if (count === 0) return { start: 0, end: 0 };
  const top = Math.max(0, scrollTop);
  const bottom = top + Math.max(0, viewportHeight);

  let firstVisible = 0;
  while (firstVisible < count && offsets[firstVisible] + heights[firstVisible] <= top) firstVisible++;

  let pastVisible = firstVisible;
  while (pastVisible < count && offsets[pastVisible] < bottom) pastVisible++;

  const start = Math.max(0, firstVisible - overscan);
  const end = Math.min(count, pastVisible + overscan);
  return { start, end };
}
