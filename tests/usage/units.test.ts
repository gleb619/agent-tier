import { describe, expect, it } from "vitest";
import {
  budgetState,
  formatDuration,
  formatTokens,
  parseDuration,
  parseTokens,
  variancePct,
} from "../../src/usage/units";

describe("usage units", () => {
  it("parseDuration", () => {
    expect(parseDuration("45m")).toBe(45 * 60_000);
    expect(parseDuration("1h30m")).toBe(90 * 60_000);
    expect(parseDuration("2h")).toBe(7_200_000);
    expect(parseDuration("90s")).toBe(90_000);
    expect(parseDuration("1.5h")).toBe(5_400_000);
    expect(parseDuration("-")).toBeNull();
    expect(parseDuration("")).toBeNull();
    expect(parseDuration("soon")).toBeNull();
    expect(parseDuration(undefined)).toBeNull();
  });
  it("parseTokens", () => {
    expect(parseTokens("900")).toBe(900);
    expect(parseTokens("120k")).toBe(120_000);
    expect(parseTokens("1.5M")).toBe(1_500_000);
    expect(parseTokens("1,200")).toBe(1200);
    expect(parseTokens("-")).toBeNull();
    expect(parseTokens("lots")).toBeNull();
  });
  it("formatDuration", () => {
    expect(formatDuration(45_000)).toBe("45s");
    expect(formatDuration(12 * 60_000)).toBe("12m");
    expect(formatDuration(65 * 60_000)).toBe("1h05m");
    expect(formatDuration(27 * 3_600_000)).toBe("1d3h");
    expect(formatDuration(null)).toBe("-");
    expect(formatDuration(-1)).toBe("-");
  });
  it("formatTokens", () => {
    expect(formatTokens(900)).toBe("900");
    expect(formatTokens(1200)).toBe("1.2k");
    expect(formatTokens(84_000)).toBe("84k");
    expect(formatTokens(120_000)).toBe("120k");
    expect(formatTokens(1_200_000)).toBe("1.2M");
    expect(formatTokens(null)).toBe("-");
  });
  it("roundtrip", () => {
    expect(parseTokens(formatTokens(120_000))).toBe(120_000);
    expect(parseDuration(formatDuration(65 * 60_000))).toBe(65 * 60_000);
  });
  it("budget + variance", () => {
    expect(budgetState(100, 90)).toBe("under");
    expect(budgetState(100, 120)).toBe("near");
    expect(budgetState(100, 200)).toBe("over");
    expect(budgetState(null, 5)).toBe("none");
    expect(variancePct(100, 120)).toBe("+20%");
    expect(variancePct(100, 40)).toBe("-60%");
    expect(variancePct(null, 4)).toBe("-");
  });
});
