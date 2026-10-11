import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "..");

const DOC_FILES = ["docs/cli.md", "docs/progress.md", "docs/agents.md", "docs/architecture.md"];

function read(relPath: string): string {
  return readFileSync(path.join(ROOT, relPath), "utf8");
}

function lineCount(relPath: string): number {
  const text = read(relPath).replace(/\r\n/g, "\n").replace(/\n$/, "");
  return text.length === 0 ? 0 : text.split("\n").length;
}

function markdownLinks(relPath: string): string[] {
  return [...read(relPath).matchAll(/\]\(([^)#\s]+)(?:#[^)]*)?\)/g)].map((m) => m[1]);
}

describe("documentation layout", () => {
  it("README.md stays under 100 lines", () => {
    expect(lineCount("README.md")).toBeLessThan(100);
  });

  it("AGENTS.md stays under 150 lines", () => {
    expect(lineCount("AGENTS.md")).toBeLessThan(150);
  });

  it.each(["README.md", "AGENTS.md", ...DOC_FILES])("%s relative markdown links resolve", (file) => {
    for (const link of markdownLinks(file)) {
      if (/^[a-z][a-z0-9+.-]*:/i.test(link)) continue; // external scheme
      const target = path.resolve(ROOT, path.dirname(file), link);
      expect(existsSync(target), `${file} links to missing ${link}`).toBe(true);
    }
  });

  it("README.md and AGENTS.md link every docs/*.md file", () => {
    for (const file of DOC_FILES) {
      expect(read("README.md"), `README should link ${file}`).toContain(`(${file})`);
      expect(read("AGENTS.md"), `AGENTS should link ${file}`).toContain(`(${file})`);
    }
  });

  it("content moved out of README/AGENTS is preserved in docs/", () => {
    const preserved: Array<[string, string[]]> = [
      [
        "docs/cli.md",
        [
          "## Sending prompts",
          "## Output modes",
          "## Retry behavior",
          "## Post-run verification hook",
          "AT_STATUS=failed",
          "AT_VERIFY_CMD",
          "min(retries, candidates.length - 1)",
          '"agent": "opencode"',
        ],
      ],
      [
        "docs/progress.md",
        [
          "## Live progress (SSE)",
          "Last-Event-ID",
          "## Discuss channel",
          "at discuss ask",
          "AT_SSE_URL",
          "make<Name>Adapter",
          "AT_STATE_DIR",
          "DISCUSS_INSTRUCTION",
        ],
      ],
      [
        "docs/agents.md",
        [
          "## Tiers",
          "## Available agents",
          "Round-robin order: mm-code",
          "## Model override",
          "promptMode",
          "## Generic agents (plugins)",
          "AT_GENERIC_DIR",
          "## Binary resolution",
          "## Configuration",
          "tierOverrides",
          "at config sign",
        ],
      ],
      [
        "docs/architecture.md",
        [
          "## Key design points",
          "## State locking",
          "## Adding an agent",
          "withLock",
          "run-watch.ts",
          "defaultSpawner",
          "src/agents/generic-loader.ts",
          "src/config.ts",
          "feedback.jsonl",
          "HTTP/SSE hub",
        ],
      ],
    ];
    for (const [file, needles] of preserved) {
      const content = read(file);
      for (const needle of needles) {
        expect(content, `${file} should preserve "${needle}"`).toContain(needle);
      }
    }
  });
});
