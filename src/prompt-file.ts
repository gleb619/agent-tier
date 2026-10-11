import fs from "node:fs";

/**
 * Read a prompt from a file path. Supports .md (raw text) and .json
 * (parsed; if the JSON has a top-level `prompt` string field, return that,
 * otherwise return the raw file contents).
 *
 * Throws on read failure so callers can surface a clear error.
 */
export function readPromptFile(filePath: string): string {
  try {
    const ext = filePath.split(".").pop()?.toLowerCase();
    const content = fs.readFileSync(filePath, "utf8");

    if (ext === "json") {
      try {
        const parsed = JSON.parse(content);
        if (parsed && typeof parsed === "object" && typeof parsed.prompt === "string") {
          return parsed.prompt;
        }
        return content;
      } catch {
        return content;
      }
    }
    return content;
  } catch (error) {
    throw new Error(`Failed to read prompt file: ${(error as Error).message}`);
  }
}
