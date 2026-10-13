import { pwaInstall } from "$stores/pwa";
import App from "./App.svelte";
import "$/styles/tailwind.css";
import { registerServiceWorker } from "$utils/register-sw";
import { startRouter } from "$utils/router";

const app = new App({
  target: document.getElementById("app")!,
});

pwaInstall.attach();
startRouter();
registerServiceWorker();

export default app;
