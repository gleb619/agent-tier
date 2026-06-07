import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts', 'tests_ai/**/*.test.ts'],
    exclude: [],
    testTimeout: 360000,
    hookTimeout: 360000,
    globals: true,
    environment: 'node',
    setupFiles: ['tests/setup.ts'],
    coverage: {
      provider: "v8" as const,
      reporter: ["json-summary", "text", "json"],
      reportsDirectory: "./coverage",
      include: ["src/**/*.ts"],
      exclude: ["src/tui/**", "src/types/**", "node_modules/**"]
    }
  },
});