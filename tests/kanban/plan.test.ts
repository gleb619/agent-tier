import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parsePlanKeywords } from "../../src/compose/task-source";
import { ensurePlanFile, planSkeleton, splitKeywords } from "../../src/kanban/plan";
import { cleanupTmpDirs, makeTmpDir } from "./helpers";

afterEach(cleanupTmpDirs);

const meta = { id: "T7", title: "Add login", description: "jwt flow" };

describe("splitKeywords", () => {
  it("trims, dedupes, drops blanks", () => {
    expect(splitKeywords(" a, b ,,a ")).toEqual(["a", "b"]);
    expect(splitKeywords(undefined)).toEqual([]);
  });
});

describe("planSkeleton", () => {
  it("keeps keywords in the head so compose parses them", () => {
    const text = planSkeleton({ ...meta, keywords: ["auth", "src/auth/login.ts"] });
    expect(text).toContain("## Keywords");
    expect(parsePlanKeywords(text)).toEqual(["auth", "src/auth/login.ts"]);
  });

  it("an unfilled Keywords section yields no keywords (placeholder ignored)", () => {
    expect(parsePlanKeywords(planSkeleton({ ...meta, keywords: [] }))).toEqual([]);
  });
});

describe("ensurePlanFile", () => {
  it("creates a missing file (and parent dirs)", () => {
    const abs = path.join(makeTmpDir(), "plans", "T7.md");
    expect(ensurePlanFile(abs, { ...meta, keywords: ["x"] })).toBe("created");
    expect(parsePlanKeywords(readFileSync(abs, "utf8"))).toEqual(["x"]);
  });

  it("adds a Keywords section to an existing plan that lacks one", () => {
    const abs = path.join(makeTmpDir(), "T7.md");
    writeFileSync(abs, "# T7\n\nBody text\n");
    expect(ensurePlanFile(abs, { ...meta, keywords: ["a", "b"] })).toBe("keywords-added");
    const text = readFileSync(abs, "utf8");
    expect(parsePlanKeywords(text)).toEqual(["a", "b"]);
    expect(text).toContain("Body text");
  });

  it("fills an empty Keywords heading instead of duplicating it", () => {
    const abs = path.join(makeTmpDir(), "T7.md");
    writeFileSync(abs, planSkeleton({ ...meta, keywords: [] }));
    expect(ensurePlanFile(abs, { ...meta, keywords: ["a"] })).toBe("keywords-added");
    const text = readFileSync(abs, "utf8");
    expect(text.match(/## Keywords/g)).toHaveLength(1);
    expect(parsePlanKeywords(text)).toEqual(["a"]);
  });

  it("never rewrites existing keywords", () => {
    const abs = path.join(makeTmpDir(), "T7.md");
    writeFileSync(abs, "# T7\n\nKeywords: keep\n");
    expect(ensurePlanFile(abs, { ...meta, keywords: ["other"] })).toBe("unchanged");
    expect(parsePlanKeywords(readFileSync(abs, "utf8"))).toEqual(["keep"]);
  });

  it("existing file + no keywords supplied is left alone", () => {
    const abs = path.join(makeTmpDir(), "T7.md");
    writeFileSync(abs, "# T7\n");
    expect(ensurePlanFile(abs, { ...meta, keywords: [] })).toBe("unchanged");
    expect(readFileSync(abs, "utf8")).toBe("# T7\n");
  });
});

describe("parsePlanKeywords sections", () => {
  it("reads bullets under a Keywords heading", () => {
    const plan = "# T\n\n## Keywords\n\n- auth\n- `src/a.ts`\n\n## Design\n- not-a-keyword\n";
    expect(parsePlanKeywords(plan)).toEqual(["auth", "src/a.ts"]);
  });
});
