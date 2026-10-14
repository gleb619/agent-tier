import { scanForFatalMarkers } from "../src/fatal-markers";

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
