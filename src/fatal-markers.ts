export const FATAL_MARKERS: ReadonlyArray<{ name: string; pattern: RegExp }> = [
  { name: "unrecognized_model", pattern: /\[claude-code:unrecognized_model\]/ },
  { name: "quota_429", pattern: /API Error: Request rejected \(429\)/ },
  { name: "usage_limit", pattern: /usage limit has been reached/i },
  // agy (tier-3) can exit 0 after leaking its raw tool-call channel as final output.
  { name: "leaked_tool_call", pattern: /<\|channel\|>commentary<\|message\|>/ },
];

const FATAL_SCAN_LINES = 200;
const FATAL_SCAN_BYTES = 32 * 1024;

export function scanForFatalMarkers(logContent: string): string | null {
  const lines = logContent.split("\n");
  const tailLines = lines.length > FATAL_SCAN_LINES ? lines.slice(-FATAL_SCAN_LINES) : lines;
  let tail = tailLines.join("\n");
  if (tail.length > FATAL_SCAN_BYTES) {
    tail = tail.slice(-FATAL_SCAN_BYTES);
  }
  for (const m of FATAL_MARKERS) {
    const match = tail.match(m.pattern);
    if (match) return match[0];
  }
  return null;
}

const QUOTA_MARKER_NAMES: ReadonlySet<string> = new Set(["quota_429", "usage_limit"]);

/**
 * True when a marker matched by scanForFatalMarkers means provider quota /
 * rate-limit exhaustion — the signal to park the agent instead of retrying it.
 */
export function isQuotaMarker(matched: string): boolean {
  return FATAL_MARKERS.some((m) => QUOTA_MARKER_NAMES.has(m.name) && m.pattern.test(matched));
}
