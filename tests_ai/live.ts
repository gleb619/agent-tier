import { describe } from "vitest";

/**
 * Live-agent gate: the whole tests_ai suite self-skips unless AT_LIVE_AGENTS=1.
 * Every tests_ai/*.test.ts must wrap its suites in describeLive instead of describe.
 */
export const LIVE_AGENTS_ENABLED = process.env.AT_LIVE_AGENTS === "1";

export const describeLive = LIVE_AGENTS_ENABLED ? describe : describe.skip;
