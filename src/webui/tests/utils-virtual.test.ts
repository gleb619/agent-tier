import { describe, expect, it } from "vitest";
import { layoutOffsets, virtualRange } from "../utils/virtual";

const H = [10, 20, 30, 40, 50]; // offsets 0, 10, 30, 60, 100 (total 150)

describe("layoutOffsets", () => {
  it("computes prefix offsets", () => {
    expect(layoutOffsets(H)).toEqual([0, 10, 30, 60, 100]);
  });

  it("handles empty lists", () => {
    expect(layoutOffsets([])).toEqual([]);
  });
});

describe("virtualRange", () => {
  it("returns everything when content fits the viewport", () => {
    expect(virtualRange(layoutOffsets(H), H, 0, 1000, 0)).toEqual({ start: 0, end: 5 });
  });

  it("clips rows fully outside the viewport", () => {
    // viewport 20px starting at scrollTop=30 → covers 30..50, only row 2 (30..60) intersects
    expect(virtualRange(layoutOffsets(H), H, 30, 20, 0)).toEqual({ start: 2, end: 3 });
  });

  it("extends by overscan on both sides, clamped", () => {
    expect(virtualRange(layoutOffsets(H), H, 30, 20, 2)).toEqual({ start: 0, end: 5 });
    expect(virtualRange(layoutOffsets(H), H, 30, 20, 1)).toEqual({ start: 1, end: 4 });
  });

  it("handles empty lists", () => {
    expect(virtualRange([], [], 0, 100, 0)).toEqual({ start: 0, end: 0 });
  });

  it("treats negative scroll as 0", () => {
    // clamped to scrollTop=0, viewport 25 → covers 0..25, rows 0 (0..10) and 1 (10..30)
    expect(virtualRange(layoutOffsets(H), H, -50, 25, 0)).toEqual({ start: 0, end: 2 });
  });
});
