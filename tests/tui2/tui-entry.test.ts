import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveTuiEntry } from "../../src/tui-entry";

const classic = path.join("src", "tui", "index.tsx");
const experimental = path.join("src", "tui2", "index.tsx");

describe("resolveTuiEntry", () => {
  it("uses the classic TUI by default", () => {
    expect(resolveTuiEntry({})).toContain(classic);
  });

  it("uses tui2 only when AT_EXPERIMENTAL_TUI=1", () => {
    expect(resolveTuiEntry({ AT_EXPERIMENTAL_TUI: "1" })).toContain(experimental);
  });

  it("ignores any other value of the switch", () => {
    for (const value of ["0", "true", "", "yes"]) {
      expect(resolveTuiEntry({ AT_EXPERIMENTAL_TUI: value })).toContain(classic);
    }
  });

  it("returns an absolute path to an entry file that exists", () => {
    for (const entry of [resolveTuiEntry({}), resolveTuiEntry({ AT_EXPERIMENTAL_TUI: "1" })]) {
      expect(path.isAbsolute(entry), entry).toBe(true);
      expect(existsSync(entry), `${entry} should exist`).toBe(true);
    }
  });

  it("resolves both entries inside this repo", () => {
    const repoRoot = path.resolve(__dirname, "..", "..");
    expect(path.dirname(resolveTuiEntry({}))).toBe(path.join(repoRoot, "src", "tui"));
    expect(path.dirname(resolveTuiEntry({ AT_EXPERIMENTAL_TUI: "1" }))).toBe(path.join(repoRoot, "src", "tui2"));
  });
});
