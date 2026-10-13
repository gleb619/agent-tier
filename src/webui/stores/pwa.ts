import { get, writable } from "svelte/store";
import type { BeforeInstallPromptEvent } from "$types/pwa";

export interface PwaInstallState {
  canInstall: boolean;
  isInstalled: boolean;
}

let deferredPrompt: BeforeInstallPromptEvent | null = null;
let attached = false;

function createPwaInstallStore() {
  const { subscribe, set } = writable<PwaInstallState>({
    canInstall: false,
    isInstalled: false,
  });

  function setState(patch: Partial<PwaInstallState>) {
    const next = { ...get(pwaInstall), ...patch };
    set(next);
  }

  function attach() {
    if (attached || typeof window === "undefined") return;
    attached = true;

    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      deferredPrompt = event as BeforeInstallPromptEvent;
      setState({ canInstall: true });
    };

    const onAppInstalled = () => {
      deferredPrompt = null;
      setState({ canInstall: false, isInstalled: true });
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onAppInstalled);

    if (typeof window.matchMedia === "function" && window.matchMedia("(display-mode: standalone)").matches) {
      setState({ isInstalled: true });
    }
  }

  return {
    subscribe,
    attach,
    install: async () => {
      if (!deferredPrompt) return;
      await deferredPrompt.prompt();
      await deferredPrompt.userChoice;
    },
  };
}

export const pwaInstall = createPwaInstallStore();
