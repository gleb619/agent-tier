import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { computeUsage, estimateUsage, parseReportedUsage, usageForRun } from "../../src/usage/extract";

describe("parseReportedUsage", () => {
  it("cline run_result usage (last cumulative wins)", () => {
    const log = [
      "[at] runId: x",
      '{"type":"run_result","usage":{"inputTokens":10,"outputTokens":2}}',
      '{"type":"run_result","usage":{"inputTokens":120,"outputTokens":30,"totalCost":0}}',
    ].join("\n");
    expect(parseReportedUsage(log)).toEqual({ tokensIn: 120, tokensOut: 30 });
  });
  it("opencode step-finish records are summed", () => {
    const log = [
      '{"type":"step_finish","part":{"type":"step-finish","tokens":{"input":100,"output":20,"reasoning":0}}}',
      '{"type":"step_finish","part":{"type":"step-finish","tokens":{"input":50,"output":5}}}',
    ].join("\n");
    expect(parseReportedUsage(log)).toEqual({ tokensIn: 150, tokensOut: 25 });
  });
  it("snake_case usage nested in payload", () => {
    const log = '{"type":"result","payload":{"usage":{"input_tokens":7,"output_tokens":3}}}';
    expect(parseReportedUsage(log)).toEqual({ tokensIn: 7, tokensOut: 3 });
  });
  it("all-zero or absent usage → null; junk lines ignored", () => {
    expect(parseReportedUsage('{"usage":{"inputTokens":0,"outputTokens":0}}\nnot json {usage')).toBeNull();
    expect(parseReportedUsage("plain text")).toBeNull();
  });
});

describe("computeUsage", () => {
  it("falls back to chars/4 estimate", () => {
    expect(estimateUsage("abcdefgh", "x".repeat(40))).toEqual({ tokensIn: 2, tokensOut: 10, source: "estimated" });
    expect(computeUsage("abcd", "hello")).toMatchObject({ source: "estimated", tokensIn: 1, tokensOut: 2 });
  });
  it("prefers reported", () => {
    expect(computeUsage("p", '{"usage":{"inputTokens":5,"outputTokens":6}}')).toEqual({
      tokensIn: 5,
      tokensOut: 6,
      source: "reported",
    });
  });
  it("usageForRun reads the file; missing file estimates from prompt only", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "at-usage-"));
    try {
      const f = path.join(dir, "a.log");
      writeFileSync(f, '{"usage":{"inputTokens":9,"outputTokens":1}}\n');
      expect(usageForRun("prompt", f)).toMatchObject({ tokensIn: 9, tokensOut: 1, source: "reported" });
      expect(usageForRun("abcdefgh", path.join(dir, "nope.log"))).toEqual({
        tokensIn: 2,
        tokensOut: 0,
        source: "estimated",
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
