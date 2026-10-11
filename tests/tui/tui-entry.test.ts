import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveTuiEntry } from "../../src/tui-entry";

const entryRel = path.join("src", "tui", "index.tsx");

describe("resolveTuiEntry", () => {
  it("returns the TUI entry", () => {
    expect(resolveTuiEntry({})).toContain(entryRel);
  });

  it("returns an absolute path to an entry file that exists", () => {
    const entry = resolveTuiEntry();
    expect(path.isAbsolute(entry), entry).toBe(true);
    expect(existsSync(entry), `${entry} should exist`).toBe(true);
  });

  it("resolves the entry inside this repo", () => {
    const repoRoot = path.resolve(__dirname, "..", "..");
    expect(path.dirname(resolveTuiEntry())).toBe(path.join(repoRoot, "src", "tui"));
  });
});
