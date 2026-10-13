import { get } from "svelte/store";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("pwa install store", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("starts not installable and not installed", async () => {
    const { pwaInstall } = await import("../stores/pwa");
    const state = get(pwaInstall);
    expect(state.canInstall).toBe(false);
    expect(state.isInstalled).toBe(false);
  });

  it("becomes installable on beforeinstallprompt", async () => {
    const { pwaInstall } = await import("../stores/pwa");
    pwaInstall.attach();

    const event = new Event("beforeinstallprompt", { cancelable: true });
    let prevented = false;
    event.preventDefault = () => {
      prevented = true;
    };
    Object.assign(event, {
      prompt: vi.fn().mockResolvedValue(undefined),
      userChoice: Promise.resolve({ outcome: "accepted", platform: "web" }),
    });

    window.dispatchEvent(event);
    expect(prevented).toBe(true);
    expect(get(pwaInstall).canInstall).toBe(true);
  });

  it("install() calls prompt() and resets after appinstalled", async () => {
    const { pwaInstall } = await import("../stores/pwa");
    pwaInstall.attach();

    const prompt = vi.fn().mockResolvedValue(undefined);
    const event = new Event("beforeinstallprompt", { cancelable: true });
    Object.assign(event, {
      preventDefault: () => undefined,
      prompt,
      userChoice: Promise.resolve({ outcome: "accepted", platform: "web" }),
    });

    window.dispatchEvent(event);
    expect(get(pwaInstall).canInstall).toBe(true);

    await pwaInstall.install();
    expect(prompt).toHaveBeenCalledTimes(1);

    window.dispatchEvent(new Event("appinstalled"));
    expect(get(pwaInstall).canInstall).toBe(false);
    expect(get(pwaInstall).isInstalled).toBe(true);
  });

  it("marks installed when launched in standalone mode", async () => {
    const matchMediaSpy = vi.spyOn(window, "matchMedia").mockReturnValue({
      matches: true,
      media: "(display-mode: standalone)",
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    } as unknown as MediaQueryList);

    const { pwaInstall } = await import("../stores/pwa");
    pwaInstall.attach();

    expect(get(pwaInstall).isInstalled).toBe(true);
    expect(matchMediaSpy).toHaveBeenCalledWith("(display-mode: standalone)");
  });
});
