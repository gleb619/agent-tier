/**
 * Discuss channel is EXPERIMENTAL and machine-to-machine (compose two-agent
 * orchestrator ↔ implementer). Off unless `AT_DISCUSS=1|true|yes|on` is set
 * (`at compose --two-agents --discuss` exports it to the agents it starts).
 */
export function discussEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return /^(1|true|yes|on)$/i.test((env.AT_DISCUSS ?? "").trim());
}

export const DISCUSS_DISABLED_MSG =
  "[at] discuss is experimental and disabled. Enable with AT_DISCUSS=1 (or `at compose --two-agents --discuss`).";
