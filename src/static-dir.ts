import { existsSync } from "node:fs";
import path from "node:path";

/**
 * Default WebUI build dir: <package root>/src/webui/dist. The compiled helper
 * lives at dist/static-dir.js, so two levels up is the package root.
 */
export function defaultWebUiStaticDir(rootDir: string = path.resolve(__dirname, "..", "..")): string {
  return path.join(rootDir, "src", "webui", "dist");
}

/**
 * Resolve which static dir `at web` serves: the explicit `--static` value if
 * given, else the built WebUI (src/webui/dist) when present, else undefined
 * (API-only mode).
 */
export function resolveWebUiStaticDir(explicit?: string, rootDir?: string): string | undefined {
  if (explicit) return path.resolve(explicit);
  const dir = defaultWebUiStaticDir(rootDir);
  return existsSync(dir) ? dir : undefined;
}
