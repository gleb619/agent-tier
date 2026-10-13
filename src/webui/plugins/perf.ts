import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { extname, join, posix, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { brotliCompress, gzip, constants as zlibConstants } from "node:zlib";
import type { Plugin } from "vite";

const brotliAsync = promisify(brotliCompress);
const gzipAsync = promisify(gzip);

interface PerfOptions {
  /** Build output directory relative to Vite root. */
  outDir: string;
  /** Maximum direct-import depth of the entry chunk to modulepreload. */
  preloadDepth: number;
}

const defaults: PerfOptions = {
  outDir: "dist",
  preloadDepth: 1,
};

/** Extensions worth precompressing (text assets served to browsers). */
const COMPRESSIBLE = new Set([".html", ".js", ".css", ".svg", ".json", ".webmanifest", ".txt", ".map"]);

/** Static relative import specifiers in an esm chunk: `from "./x.js"` / `import "./x.js"`. */
const staticImportRe = /(?:import|from)\s*(?:[\w$]+\s*,?\s*)?["'](\.{1,2}\/[^"']+)["']/g;

/** Recursively collect relative static imports of `entry`, up to `depth` levels. */
export function collectPreloadSet(assets: Map<string, string>, entry: string, depth: number): Set<string> {
  const seen = new Set<string>([entry]);
  let frontier = [entry];
  for (let level = 0; level < depth; level++) {
    const next: string[] = [];
    for (const file of frontier) {
      const code = assets.get(file);
      if (code === undefined) continue;
      staticImportRe.lastIndex = 0;
      for (let match = staticImportRe.exec(code); match !== null; match = staticImportRe.exec(code)) {
        const dep = posix.normalize(posix.join(posix.dirname(file), match[1]!));
        if (!seen.has(dep) && assets.has(dep)) {
          seen.add(dep);
          next.push(dep);
        }
      }
    }
    frontier = next;
  }
  return seen;
}

/** Inject `<link rel="modulepreload">` (entry graph) and `<link rel="prefetch">` (lazy chunks). */
export function injectPreloadHints(html: string, preload: string[], prefetch: string[]): string {
  const hints = [
    ...preload.map((href) => `    <link rel="modulepreload" crossorigin href="/${href}" />`),
    ...prefetch.map((href) => `    <link rel="prefetch" href="/${href}" />`),
  ].join("\n");
  if (hints === "") return html;
  return html.replace(/<head>/, `<head>\n${hints}`);
}

/** Entry chunk referenced by the built index.html module script, if any. */
export function findEntryScript(html: string): string | null {
  const match = /<script[^>]*type="module"[^>]*src="\/([^"]+)"/.exec(html);
  return match?.[1] ?? null;
}

export function isCompressible(file: string): boolean {
  return COMPRESSIBLE.has(extname(file).toLowerCase());
}

/**
 * Build-time performance pass, run after the bundle (and the SW precache
 * manifest) is written:
 *
 * 1. Injects resource hints into index.html — modulepreload for the entry
 *    chunk and its static imports (kills the import waterfall), prefetch for
 *    the lazy view chunks.
 * 2. Writes precompressed `.br` / `.gz` siblings for every text asset so the
 *    Go static server can serve them without on-the-fly compression.
 */
export function perf(options: Partial<PerfOptions> = {}): Plugin {
  const opts = { ...defaults, ...options };
  return {
    name: "at-perf",
    apply: "build",
    closeBundle: async () => {
      const dist = resolve(process.cwd(), opts.outDir);
      const files = await collectFiles(dist);
      const jsAssets = files.filter((f) => f.startsWith("assets/") && f.endsWith(".js"));

      const html = await readFile(join(dist, "index.html"), "utf8");
      const entry = findEntryScript(html);
      if (entry) {
        const assets = new Map<string, string>();
        for (const file of jsAssets) {
          assets.set(file, await readFile(join(dist, file), "utf8"));
        }
        const preloadSet = collectPreloadSet(assets, entry, opts.preloadDepth);
        const preload = [...preloadSet].sort();
        const prefetch = jsAssets.filter((f) => !preloadSet.has(f)).sort();
        await writeFile(join(dist, "index.html"), injectPreloadHints(html, preload, prefetch));
      }

      for (const file of files) {
        if (!isCompressible(file)) continue;
        const full = join(dist, file);
        const data = await readFile(full);
        await writeFile(`${full}.br`, await compressBrotli(data));
        await writeFile(`${full}.gz`, await gzipAsync(data));
      }
    },
  };
}

async function compressBrotli(data: Buffer): Promise<Buffer> {
  return brotliAsync(data, {
    params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 11, [zlibConstants.BROTLI_PARAM_SIZE_HINT]: data.length },
  });
}

/** All files under dir, relative POSIX paths, excluding generated compression siblings. */
async function collectFiles(base: string, dir = base): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await collectFiles(base, full)));
      continue;
    }
    if (entry.name.endsWith(".br") || entry.name.endsWith(".gz")) continue;
    const rel = relative(base, full).replace(/\\/g, "/");
    if ((await stat(full)).size === 0) continue;
    out.push(rel);
  }
  return out;
}
