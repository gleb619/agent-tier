import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import type { Plugin } from "vite";

interface SwManifestOptions {
  /** Build output directory relative to Vite root. */
  outDir: string;
  /** Service worker output filename at the root of outDir. */
  swFile: string;
  /** Relative paths (without leading slash) to exclude from the precache manifest. */
  exclude: string[];
}

const defaults: SwManifestOptions = {
  outDir: "dist",
  swFile: "sw.js",
  exclude: ["sw.js", "index.html.map", ".vite"],
};

/**
 * Small in-repo Vite plugin that injects a precache manifest into the built
 * service worker. After the bundle is written it scans the output directory,
 * builds a list of root-relative URLs and replaces `self.__SW_ASSETS__` in
 * `dist/sw.js` with that array.
 */
export function swManifest(options: Partial<SwManifestOptions> = {}): Plugin {
  const opts = { ...defaults, ...options };
  const exclude = new Set(opts.exclude);
  return {
    name: "at-sw-manifest",
    apply: "build",
    closeBundle: async () => {
      const dist = join(process.cwd(), opts.outDir);
      const manifest = await collectManifest(dist, dist, exclude);
      const swPath = join(dist, opts.swFile);
      let code = await readFile(swPath, "utf8");
      code = code.replace(/self\.__SW_ASSETS__/g, JSON.stringify(manifest));
      await writeFile(swPath, code);
    },
  };
}

async function collectManifest(base: string, dir: string, exclude: Set<string>): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectManifest(base, full, exclude)));
      continue;
    }
    const rel = `/${relative(base, full).replace(/\\/g, "/")}`;
    if (exclude.has(rel.replace(/^\/+/, ""))) continue;
    // Precompressed siblings written by the perf plugin are not precached.
    if (rel.endsWith(".br") || rel.endsWith(".gz")) continue;
    files.push(rel);
  }
  return files;
}
