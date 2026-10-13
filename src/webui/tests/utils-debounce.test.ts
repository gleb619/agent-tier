import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { debounce } from "../utils/debounce";

describe("debounce", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("fires once after the last call (trailing edge)", () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 100);
    debounced("a");
    debounced("b");
    debounced("c");
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith("c");
  });

  it("keeps collapsing bursts into single invocations", () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 50);
    for (let i = 0; i < 10; i++) {
      debounced(i);
      vi.advanceTimersByTime(40);
    }
    vi.advanceTimersByTime(50);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith(9);
  });

  it("cancel drops a pending invocation", () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 100);
    debounced();
    debounced.cancel();
    vi.advanceTimersByTime(200);
    expect(fn).not.toHaveBeenCalled();
  });
});
