import { describe, expect, it } from "vitest";
import { buildScopeSuffix, findScopeViolations, globToRegExp, matchesScope } from "../src/scope";

// ---------------------------------------------------------------------------
// globToRegExp
// ---------------------------------------------------------------------------
describe("globToRegExp", () => {
  it("matches exact file name", () => {
    expect(globToRegExp("src/foo.ts").test("src/foo.ts")).toBe(true);
    expect(globToRegExp("src/foo.ts").test("src/bar.ts")).toBe(false);
  });

  it("* does not cross directory boundaries", () => {
    const re = globToRegExp("src/*.ts");
    expect(re.test("src/foo.ts")).toBe(true);
    expect(re.test("src/bar.ts")).toBe(true);
    expect(re.test("src/sub/foo.ts")).toBe(false);
  });

  it("? matches exactly one non-slash character", () => {
    const re = globToRegExp("src/?.ts");
    expect(re.test("src/a.ts")).toBe(true);
    expect(re.test("src/ab.ts")).toBe(false);
    expect(re.test("src/.ts")).toBe(false);
  });

  it("** matches zero or more path segments", () => {
    const re = globToRegExp("src/**/*.ts");
    expect(re.test("src/foo.ts")).toBe(true);
    expect(re.test("src/sub/foo.ts")).toBe(true);
    expect(re.test("src/a/b/c/foo.ts")).toBe(true);
    expect(re.test("lib/foo.ts")).toBe(false);
  });

  it("** alone matches anything", () => {
    const re = globToRegExp("**");
    expect(re.test("src/foo.ts")).toBe(true);
    expect(re.test("README.md")).toBe(true);
  });

  it("**/*.ts matches at root level too", () => {
    const re = globToRegExp("**/*.ts");
    expect(re.test("foo.ts")).toBe(true);
    expect(re.test("src/foo.ts")).toBe(true);
    expect(re.test("src/sub/foo.ts")).toBe(true);
  });

  it("escapes regex special chars in literal path segments", () => {
    const re = globToRegExp("src/foo.bar.ts");
    expect(re.test("src/foo.bar.ts")).toBe(true);
    expect(re.test("src/fooXbar.ts")).toBe(false);
  });

  it("strips leading ./ from pattern", () => {
    const re = globToRegExp("./src/foo.ts");
    expect(re.test("src/foo.ts")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// matchesScope
// ---------------------------------------------------------------------------
describe("matchesScope", () => {
  it("returns true for empty pattern list (no scope restriction)", () => {
    expect(matchesScope("anything/foo.ts", [])).toBe(true);
  });

  it("matches against any of the provided patterns", () => {
    const patterns = ["src/**/*.ts", "tests/**/*.ts"];
    expect(matchesScope("src/foo.ts", patterns)).toBe(true);
    expect(matchesScope("tests/bar.test.ts", patterns)).toBe(true);
    expect(matchesScope("docs/readme.md", patterns)).toBe(false);
  });

  it("normalises leading ./ in file path", () => {
    expect(matchesScope("./src/foo.ts", ["src/**/*.ts"])).toBe(true);
  });

  it("normalises backslashes in file path", () => {
    expect(matchesScope("src\\foo.ts", ["src/*.ts"])).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// findScopeViolations
// ---------------------------------------------------------------------------
describe("findScopeViolations", () => {
  it("returns empty array when no globs given", () => {
    expect(findScopeViolations(["AGENTS.md", "src/foo.ts"], [])).toEqual([]);
  });

  it("returns empty array when all files match", () => {
    expect(findScopeViolations(["src/foo.ts", "src/bar.ts"], ["src/**/*.ts"])).toEqual([]);
  });

  it("returns out-of-scope files", () => {
    const violations = findScopeViolations(["src/foo.ts", "AGENTS.md", "docs/plan.md"], ["src/**/*.ts"]);
    expect(violations).toEqual(["AGENTS.md", "docs/plan.md"]);
  });

  it("handles multiple globs — a file matching any is in scope", () => {
    const violations = findScopeViolations(
      ["src/foo.ts", "tests/foo.test.ts", "README.md"],
      ["src/**/*.ts", "tests/**/*.ts"],
    );
    expect(violations).toEqual(["README.md"]);
  });

  it("returns empty when changed paths list is empty", () => {
    expect(findScopeViolations([], ["src/**/*.ts"])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// buildScopeSuffix
// ---------------------------------------------------------------------------
describe("buildScopeSuffix", () => {
  it("returns empty string for no globs", () => {
    expect(buildScopeSuffix([])).toBe("");
  });

  it("includes each glob in the suffix", () => {
    const suffix = buildScopeSuffix(["src/**/*.ts", "tests/**/*.ts"]);
    expect(suffix).toContain("src/**/*.ts");
    expect(suffix).toContain("tests/**/*.ts");
  });

  it("mentions not running repo-wide formatters", () => {
    const suffix = buildScopeSuffix(["src/*.ts"]);
    expect(suffix).toContain("biome");
    expect(suffix).toContain("repo-wide");
  });

  it("starts with double newline + --- separator", () => {
    const suffix = buildScopeSuffix(["src/*.ts"]);
    expect(suffix.startsWith("\n\n---\n")).toBe(true);
  });
});
