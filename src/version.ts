import { readFileSync } from "node:fs";
import path from "node:path";

/** CLI version, read once from package.json (dist/ is one level below repo root). */
export const CLI_VERSION = (
  JSON.parse(readFileSync(path.join(__dirname, "..", "package.json"), "utf8")) as { version: string }
).version;
