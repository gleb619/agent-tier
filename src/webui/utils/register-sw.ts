import { isOnline, updateAvailable } from "$stores/sw";
import { showToast } from "$stores/toast";

export async function registerServiceWorker(): Promise<void> {
  if (import.meta.env.DEV || !("serviceWorker" in navigator)) return;

  try {
    const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
    isOnline.set(navigator.onLine);

    window.addEventListener("online", () => {
      isOnline.set(true);
      // Headless/background SWs don't reliably get `online` events — tell the
      // SW to drain its offline run queue instead of relying on its listener.
      navigator.serviceWorker.controller?.postMessage({ type: "DRAIN_QUEUE" });
    });
    window.addEventListener("offline", () => isOnline.set(false));

    registration.addEventListener("updatefound", () => {
      const installing = registration.installing;
      if (!installing) return;
      installing.addEventListener("statechange", () => {
        if (installing.state === "installed" && navigator.serviceWorker.controller) {
          updateAvailable.set(true);
          showToast("Update available", "info", 0, {
            label: "Reload",
            onClick: () => {
              installing.postMessage({ type: "SKIP_WAITING" });
            },
          });
        }
      });
    });

    navigator.serviceWorker.addEventListener("message", (event) => {
      const data = event.data;
      if (!data || typeof data !== "object") return;
      switch (data.type) {
        case "OFFLINE":
          isOnline.set(false);
          break;
        case "ONLINE":
          isOnline.set(true);
          break;
        case "RUN_QUEUED":
          showToast("Run queued; will start when online", "info");
          break;
        case "RUN_REPLAYED":
          showToast("Queued run started", "success");
          break;
      }
    });

    navigator.serviceWorker.addEventListener("controllerchange", () => {
      window.location.reload();
    });
  } catch {
    // SW registration is best-effort; failures should not block the app.
  }
}
