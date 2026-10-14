import { isQuotaMarker, scanForFatalMarkers } from "../src/fatal-markers";

describe("scanForFatalMarkers", () => {
  it("returns null when no fatal markers are present", () => {
    const content = "[at] runId: abc123\nmodel ready\nworking...\nall good\n";
    expect(scanForFatalMarkers(content)).toBeNull();
  });

  it("returns the marker string for [claude-code:unrecognized_model]", () => {
    const content = '[claude-code:unrecognized_model] {"model":"...","query_source":"sdk"}\nSome other output\n';
    expect(scanForFatalMarkers(content)).toBe("[claude-code:unrecognized_model]");
  });

  it("returns the marker string for API Error: Request rejected (429)", () => {
    const content = "some output\nAPI Error: Request rejected (429)\nMore output\n";
    expect(scanForFatalMarkers(content)).toBe("API Error: Request rejected (429)");
  });

  it("returns the marker string for usage limit has been reached", () => {
    const content = "working...\nusage limit has been reached\nstopping\n";
    expect(scanForFatalMarkers(content)).toBe("usage limit has been reached");
  });

  it("is case-insensitive for usage limit marker", () => {
    const content = "USAGE LIMIT HAS BEEN REACHED\n";
    expect(scanForFatalMarkers(content)).toBe("USAGE LIMIT HAS BEEN REACHED");
  });

  it("returns first matched marker when multiple are present", () => {
    const content = "API Error: Request rejected (429)\n[claude-code:unrecognized_model]\n";
    // FATAL_MARKERS order: unrecognized_model first, then quota_429, then usage_limit.
    // So unrecognized_model is returned first.
    expect(scanForFatalMarkers(content)).toBe("[claude-code:unrecognized_model]");
  });

  it("returns the marker string for a leaked raw tool-call channel", () => {
    const content = "planning...\nreading src/foo.ts\n<|channel|>commentary<|message|>\n";
    expect(scanForFatalMarkers(content)).toBe("<|channel|>commentary<|message|>");
  });

  it("returns null when only partial tool-call channel text is present", () => {
    const content = "output mentioning <|channel|> and commentary but no leak\n";
    expect(scanForFatalMarkers(content)).toBeNull();
  });

  it("scans only the last 200 lines", () => {
    const manyLines = Array.from({ length: 300 }, (_, i) => `line-${i}`).join("\n");
    const content = `${manyLines}\n[claude-code:unrecognized_model]\n`;
    expect(scanForFatalMarkers(content)).toBe("[claude-code:unrecognized_model]");
  });

  it("scans only the last 32KB bytes when content is larger", () => {
    const largeLines = Array.from({ length: 5000 }, (_, i) => `${`x`.repeat(100)}-${i}`).join("\n");
    // Ensure the marker appears in the last 32KB
    const content = `${largeLines}\n[claude-code:unrecognized_model]\n`;
    expect(scanForFatalMarkers(content)).toBe("[claude-code:unrecognized_model]");
  });

  it("returns null for empty content", () => {
    expect(scanForFatalMarkers("")).toBeNull();
  });

  it("returns null for whitespace-only content", () => {
    expect(scanForFatalMarkers("   \n  \n")).toBeNull();
  });
});

describe("isQuotaMarker", () => {
  it("is true for the 429 marker text", () => {
    expect(isQuotaMarker("API Error: Request rejected (429)")).toBe(true);
  });

  it("is true for the usage-limit marker text, any case", () => {
    expect(isQuotaMarker("usage limit has been reached")).toBe(true);
    expect(isQuotaMarker("USAGE LIMIT HAS BEEN REACHED")).toBe(true);
  });

  it("is false for the non-quota fatal markers", () => {
    expect(isQuotaMarker("[claude-code:unrecognized_model]")).toBe(false);
    expect(isQuotaMarker("<|channel|>commentary<|message|>")).toBe(false);
  });

  it("is false for empty and unrelated text", () => {
    expect(isQuotaMarker("")).toBe(false);
    expect(isQuotaMarker("model ready")).toBe(false);
  });

  it("classifies the string returned by scanForFatalMarkers", () => {
    const matched = scanForFatalMarkers("boom...\nusage limit has been reached\n");
    expect(matched).not.toBeNull();
    expect(isQuotaMarker(matched as string)).toBe(true);
  });
});
