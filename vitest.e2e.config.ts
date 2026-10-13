import { defineConfig } from "vitest/config";

// WebUI E2E config — Playwright-driven browser specs in tests/e2e/webui/**
// running against a real `at web` server (booted per spec, random port, temp
// AT_STATE_DIR). Deliberately separate from the default unit config: these
// need the built CLI + WebUI dist + a chromium binary, so they run only via
// `pnpm run test:e2e`.
export default defineConfig({
  test: {
    include: ["tests/e2e/webui/**/*.test.ts"],
    testTimeout: 120_000,
    hookTimeout: 300_000,
    globals: true,
    environment: "node",
    // Each spec boots its own `at web` server + chromium — run sequentially
    // so browser/server count stays at one worker.
    maxWorkers: 1,
    globalSetup: ["tests/e2e/webui/global-setup.ts"],
  },
});
