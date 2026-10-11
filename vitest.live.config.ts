import { defineConfig } from "vitest/config";

// Live-agent suite — spawns REAL agent binaries (codex/kimi/glm-code/...),
// burns tokens/money and can hang for a long time. Opt-in ONLY:
//   AT_LIVE_AGENTS=1 vitest run --config vitest.live.config.ts  (= npm run test:agents)
// Without the flag every suite self-skips (see tests_ai/live.ts).
export default defineConfig({
  test: {
    include: ["tests_ai/**/*.test.ts"],
    exclude: [],
    testTimeout: 360000,
    hookTimeout: 360000,
    globals: true,
    environment: "node",
    setupFiles: ["tests/setup.ts", "tests_ai/live-setup.ts"],
    coverage: {
      provider: "v8" as const,
      reporter: ["json-summary", "text", "json"],
      reportsDirectory: "./coverage",
      include: ["src/**/*.ts"],
      exclude: ["src/tui/**", "src/types/**", "node_modules/**"],
    },
  },
});
