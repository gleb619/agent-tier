import App from "./App.svelte";
import "$/styles/tailwind.css";
import { pwaInstall } from "$stores/pwa";
import { startRouter } from "$utils/router";

const app = new App({
  target: document.getElementById("app")!,
});

pwaInstall.attach();
startRouter();

export default app;
