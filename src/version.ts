import { readFileSync } from "node:fs";
import path from "node:path";

function readCliVersion(): string {
  try {
    // dist/ is one level below the repo root.
    return (JSON.parse(readFileSync(path.join(__dirname, "..", "package.json"), "utf8")) as { version: string })
      .version;
  } catch {
    // Compiled binary (bun build --compile): package.json is not embedded.
    // scripts/build-at-bin.sh injects the real value via --define below.
    return "0.0.0-dev";
  }
}

/**
 * CLI version. scripts/build-at-bin.sh defines AT_VERSION at build time, so
 * the compiled binary reports the real package version without package.json.
 */
export const CLI_VERSION: string = process.env.AT_VERSION ?? readCliVersion();
