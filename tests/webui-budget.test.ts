import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";

/**
 * Bundle budget gate (docs/ideas/webui-ideas.ignore.md §13.2): the gzipped
 * bundle stays under 200KB, the initial load (entry graph + shell) under
 * 100KB. Runs only when the WebUI has been built; `pnpm run web:analyze`
 * reports the same numbers for humans.
 */

const DIST = join(__dirname, "..", "src", "webui", "dist");
const hasDist = existsSync(join(DIST, "index.html"));

/** §13.2 target: gzip bundle < 200KB. */
const TOTAL_JS_GZIP_BUDGET = 200 * 1024;
/** Initial-load budget: entry chunk graph + CSS + shell HTML. */
const INITIAL_GZIP_BUDGET = 100 * 1024;

function gzipSize(file: string): number {
  return gzipSync(readFileSync(file)).length;
}

/**
 * Root-relative initial assets referenced by the built index.html: the module
 * script, modulepreload hints and the stylesheet — but not `rel=prefetch`
 * lazy-chunk hints.
 */
function initialAssets(): string[] {
  const html = readFileSync(join(DIST, "index.html"), "utf8");
  const urls = new Set<string>();
  for (const tag of html.matchAll(/<(?:link|script)\b[^>]*>/g)) {
    if (tag[0].includes('rel="prefetch"')) continue;
    const url = /(?:src|href)="\/(assets\/[^"]+)"/.exec(tag[0]);
    if (url) urls.add(url[1]!);
  }
  return [...urls];
}

describe.skipIf(!hasDist)("webui bundle budget", () => {
  it("initial load is under the gzip budget and precompressed variants exist", () => {
    const assets = initialAssets();
    expect(assets.length).toBeGreaterThan(0);
    let total = gzipSize(join(DIST, "index.html"));
    for (const asset of assets) {
      const file = join(DIST, asset);
      expect(existsSync(file), asset).toBe(true);
      total += gzipSize(file);
      // Go static server serves these; the build must generate them.
      expect(existsSync(`${file}.br`), `${asset}.br`).toBe(true);
      expect(existsSync(`${file}.gz`), `${asset}.gz`).toBe(true);
    }
    expect(total).toBeLessThan(INITIAL_GZIP_BUDGET);
  });

  it("total gzipped JS (incl. lazy view chunks) is under the §13.2 budget", () => {
    const jsFiles = readdirSync(join(DIST, "assets")).filter((f) => f.endsWith(".js"));
    expect(jsFiles.length).toBeGreaterThan(0);
    let total = 0;
    for (const file of jsFiles) {
      total += gzipSize(join(DIST, "assets", file));
    }
    expect(total).toBeLessThan(TOTAL_JS_GZIP_BUDGET);
  });

  it("lazy views are code-split and hinted for prefetch", () => {
    const html = readFileSync(join(DIST, "index.html"), "utf8");
    expect(html).toContain('rel="prefetch"');
    const jsFiles = readdirSync(join(DIST, "assets")).filter(
      (f) => f.endsWith(".js") && statSync(join(DIST, "assets", f)).size > 0,
    );
    // Entry + at least one lazy view chunk.
    expect(jsFiles.length).toBeGreaterThanOrEqual(3);
  });
});
