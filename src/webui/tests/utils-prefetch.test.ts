import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearPrefetches, prefetchView, prefetchViewsOnIdle } from "../utils/prefetch";
import { viewModules } from "../utils/router";

describe("prefetchView", () => {
  beforeEach(() => {
    clearPrefetches();
  });
  afterEach(() => {
    clearPrefetches();
    vi.restoreAllMocks();
  });

  it("resolves to the view module from the loader", async () => {
    const fake = { default: {} as never };
    const loader = vi.fn(() => Promise.resolve(fake));
    const original = viewModules.settings;
    viewModules.settings = loader;
    try {
      await expect(prefetchView("settings")).resolves.toBe(fake);
    } finally {
      viewModules.settings = original;
    }
  });

  it("dedupes: the loader runs once per view", async () => {
    const loader = vi.fn(() => Promise.resolve({ default: {} as never }));
    const original = viewModules.settings;
    viewModules.settings = loader;
    try {
      await Promise.all([prefetchView("settings"), prefetchView("settings")]);
      expect(loader).toHaveBeenCalledTimes(1);
    } finally {
      viewModules.settings = original;
    }
  });

  it("swallows loader failures", async () => {
    const loader = () => Promise.reject(new Error("network down"));
    const original = viewModules.settings;
    viewModules.settings = loader;
    try {
      await expect(prefetchView("settings")).resolves.toBeUndefined();
    } finally {
      viewModules.settings = original;
    }
  });
});

describe("prefetchViewsOnIdle", () => {
  beforeEach(() => {
    clearPrefetches();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    clearPrefetches();
  });

  it("prefetches all views via requestIdleCallback when available", async () => {
    let idleCb: (() => void) | null = null;
    vi.stubGlobal("window", {
      requestIdleCallback: (cb: () => void) => {
        idleCb = cb;
        return 1;
      },
      cancelIdleCallback: vi.fn(),
    });
    const loader = vi.fn(() => Promise.resolve({ default: {} as never }));
    const original = viewModules.settings;
    viewModules.settings = loader;
    try {
      const cancel = prefetchViewsOnIdle(["settings"]);
      expect(loader).not.toHaveBeenCalled();
      cancel();
      expect(idleCb).not.toBeNull();
      const runIdle = idleCb as unknown as () => void;
      runIdle();
      await Promise.resolve();
      expect(loader).toHaveBeenCalledTimes(1);
    } finally {
      viewModules.settings = original;
    }
  });

  it("falls back to a timer without requestIdleCallback", async () => {
    vi.stubGlobal("window", {});
    const loader = vi.fn(() => Promise.resolve({ default: {} as never }));
    const original = viewModules.settings;
    viewModules.settings = loader;
    try {
      prefetchViewsOnIdle(["settings"]);
      await vi.waitFor(() => expect(loader).toHaveBeenCalledTimes(1));
    } finally {
      viewModules.settings = original;
    }
  });
});
