// Setup file for the live-agent suite (vitest.live.config.ts).
// Prints an explicit notice when the flag is missing (suites then self-skip
// via tests_ai/live.ts describeLive) so the skip is never silent.
if (process.env.AT_LIVE_AGENTS !== "1") {
  console.warn(
    "[tests_ai] AT_LIVE_AGENTS != 1 — live-agent suites are SKIPPED (they spawn real agents: costly). Run via: npm run test:agents",
  );
}
