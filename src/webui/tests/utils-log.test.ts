import { describe, expect, it } from "vitest";
import { filterLines, findMatches, type LogLine, splitHighlight, stepMatch, toLogLines } from "../utils/log";

function lines(...texts: string[]): LogLine[] {
  return toLogLines(texts);
}

describe("toLogLines", () => {
  it("numbers lines 1-based from `start`", () => {
    expect(toLogLines(["a", "b"])).toEqual([
      { n: 1, text: "a" },
      { n: 2, text: "b" },
    ]);
    expect(toLogLines(["c"], 41)).toEqual([{ n: 41, text: "c" }]);
  });
});

describe("filterLines", () => {
  const all = lines("hello world", "goodbye", "HELLO again");

  it("returns all lines for an empty query", () => {
    expect(filterLines(all, "")).toHaveLength(3);
    expect(filterLines(all, "   ")).toHaveLength(3);
  });

  it("filters case-insensitively and keeps original line numbers", () => {
    expect(filterLines(all, "hello").map((l) => l.n)).toEqual([1, 3]);
    expect(filterLines(all, "AGAIN").map((l) => l.text)).toEqual(["HELLO again"]);
  });

  it("returns [] when nothing matches", () => {
    expect(filterLines(all, "zzz")).toEqual([]);
  });
});

describe("findMatches / splitHighlight", () => {
  const all = lines("npm error here", "all good", "another ERROR line");

  it("findMatches returns indexes of filtered lines containing the query", () => {
    expect(findMatches(all, "error")).toEqual([0, 2]);
    expect(findMatches(all, "")).toEqual([]);
  });

  it("splitHighlight wraps every case-insensitive occurrence", () => {
    expect(splitHighlight("error and ERROR", "error")).toEqual([
      { text: "error", match: true },
      { text: " and ", match: false },
      { text: "ERROR", match: true },
    ]);
  });

  it("splitHighlight returns the whole line when the query is empty or absent", () => {
    expect(splitHighlight("abc", "")).toEqual([{ text: "abc", match: false }]);
    expect(splitHighlight("abc", "zzz")).toEqual([{ text: "abc", match: false }]);
  });
});

describe("stepMatch", () => {
  const matches = [2, 5, 9];

  it("starts at the first match (forward) or last (backward)", () => {
    expect(stepMatch(matches, null, 1)).toBe(2);
    expect(stepMatch(matches, null, -1)).toBe(9);
  });

  it("steps between matches and wraps around", () => {
    expect(stepMatch(matches, 2, 1)).toBe(5);
    expect(stepMatch(matches, 9, 1)).toBe(2);
    expect(stepMatch(matches, 5, -1)).toBe(2);
    expect(stepMatch(matches, 2, -1)).toBe(9);
  });

  it("jumps to the nearest next match when current is not a match", () => {
    expect(stepMatch(matches, 3, 1)).toBe(5);
    expect(stepMatch(matches, 3, -1)).toBe(2);
    expect(stepMatch(matches, 10, 1)).toBe(2);
  });

  it("returns null when there are no matches", () => {
    expect(stepMatch([], null, 1)).toBeNull();
    expect(stepMatch([], 5, -1)).toBeNull();
  });
});
