import { pwaInstall } from "$stores/pwa";
import App from "./App.svelte";
import "$/styles/tailwind.css";
import type { ViewType } from "$types/index";
import { prefetchViewsOnIdle } from "$utils/prefetch";
import { registerServiceWorker } from "$utils/register-sw";
import { startRouter } from "$utils/router";

const app = new App({
  target: document.getElementById("app")!,
});

pwaInstall.attach();
startRouter();
registerServiceWorker();

// Warm lazy view chunks at low priority once the app is interactive.
prefetchViewsOnIdle(["dashboard", "new-task", "run-details", "settings"] satisfies ViewType[]);

export default app;
