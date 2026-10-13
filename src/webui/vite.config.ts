import { resolve } from "node:path";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import preprocess from "svelte-preprocess";
import { defineConfig } from "vitest/config";
import { swManifest } from "./plugins/sw-manifest";

// WebUI lives in src/webui of the at repo; this config is the Vite root.
// Dev server proxies /api to the `at web` API server (default port 7800).
export default defineConfig({
  plugins: [svelte({ preprocess: preprocess() }), swManifest()],
  resolve: {
    alias: {
      $: resolve(__dirname, "."),
      $components: resolve(__dirname, "components"),
      $stores: resolve(__dirname, "stores"),
      $types: resolve(__dirname, "types"),
      $utils: resolve(__dirname, "utils"),
    },
  },
  server: {
    port: 3000,
    proxy: {
      "/api": {
        target: "http://localhost:7800",
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
  },
  build: {
    outDir: "dist",
    sourcemap: true,
    rollupOptions: {
      input: {
        index: resolve(__dirname, "index.html"),
        sw: resolve(__dirname, "sw.ts"),
      },
      output: {
        entryFileNames: (chunkInfo) => {
          return chunkInfo.name === "sw" ? "sw.js" : "assets/[name]-[hash].js";
        },
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
});
