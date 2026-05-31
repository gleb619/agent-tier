import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts', 'tests_ai/**/*.test.ts'],
    exclude: [],
    testTimeout: 360000,
    hookTimeout: 360000,
    globals: true,
    environment: 'node',
  },
});