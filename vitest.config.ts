import { defineConfig } from "vitest/config";

// Default (unit) config — tests/** ONLY. Never include tests_ai/** here: the
// live-agent suite spawns REAL agent binaries (costly, can hang). It runs only
// via `npm run test:agents` (vitest.live.config.ts, AT_LIVE_AGENTS=1).
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    exclude: [],
    testTimeout: 360000,
    hookTimeout: 360000,
    globals: true,
    environment: "node",
    setupFiles: ["tests/setup.ts"],
    coverage: {
      provider: "v8" as const,
      reporter: ["json-summary", "text", "json"],
      reportsDirectory: "./coverage",
      include: ["src/**/*.ts"],
      exclude: ["src/tui/**", "src/types/**", "node_modules/**"],
    },
  },
});
