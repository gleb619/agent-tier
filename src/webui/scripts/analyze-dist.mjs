#!/usr/bin/env node
// Bundle size report for the built WebUI: raw/gzip/brotli per asset, initial
// vs lazy totals, and a hard exit-1 when over budget (§13.2: gzip < 200KB).
// Run via `pnpm run web:analyze` (builds first).

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { brotliCompressSync, gzipSync } from "node:zlib";

const dist = join(fileURLToPath(new URL(".", import.meta.url)), "..", "dist");
const TOTAL_JS_GZIP_BUDGET = 200 * 1024;
const INITIAL_GZIP_BUDGET = 100 * 1024;

if (!existsSync(join(dist, "index.html"))) {
  console.error("dist/ not built — run `pnpm run web:build` first");
  process.exit(1);
}

const html = readFileSync(join(dist, "index.html"), "utf8");
// Initial = module script + modulepreload + stylesheet; rel=prefetch hints
// warm lazy chunks but are not part of the initial load.
const initial = new Set();
for (const tag of html.matchAll(/<(?:link|script)\b[^>]*>/g)) {
  if (tag[0].includes('rel="prefetch"')) continue;
  const url = /(?:src|href)="\/(assets\/[^"]+)"/.exec(tag[0]);
  if (url) initial.add(url[1]);
}
const jsFiles = readdirSync(join(dist, "assets")).filter((f) => f.endsWith(".js"));
const cssFiles = readdirSync(join(dist, "assets")).filter((f) => f.endsWith(".css"));

const kb = (n) => `${(n / 1024).toFixed(1)}kB`;
const row = (name, raw, gzip, br) =>
  `${name.padEnd(44)} ${kb(raw).padStart(8)} ${kb(gzip).padStart(8)} ${kb(br).padStart(8)}`;

let initialRaw = statSync(join(dist, "index.html")).size;
let initialGzip = gzipSync(readFileSync(join(dist, "index.html"))).length;
let initialBrotli = brotliCompressSync(readFileSync(join(dist, "index.html"))).length;
let totalRaw = 0;
let totalGzip = 0;
let totalBrotli = 0;

const report = (file, countTowardJsTotal) => {
  const data = readFileSync(join(dist, "assets", file));
  const raw = data.length;
  const gzip = gzipSync(data).length;
  const br = brotliCompressSync(data).length;
  if (countTowardJsTotal) {
    totalRaw += raw;
    totalGzip += gzip;
    totalBrotli += br;
  }
  if (initial.has(`assets/${file}`)) {
    initialRaw += raw;
    initialGzip += gzip;
    initialBrotli += br;
  }
  console.log(row(`${file}${initial.has(`assets/${file}`) ? " [initial]" : ""}`, raw, gzip, br));
};

console.log(`${"asset".padEnd(44)} ${"raw".padStart(8)} ${"gzip".padStart(8)} ${"br".padStart(8)}`);
for (const file of jsFiles.toSorted()) report(file, true);
for (const file of cssFiles.toSorted()) report(file, false);

console.log("─".repeat(72));
console.log(row("initial load (index.html + entry graph)", initialRaw, initialGzip, initialBrotli));
console.log(row("total JS (incl. lazy views)", totalRaw, totalGzip, totalBrotli));

let failed = false;
if (initialGzip >= INITIAL_GZIP_BUDGET) {
  console.error(`\nOVER BUDGET: initial load ${kb(initialGzip)} gzip >= ${kb(INITIAL_GZIP_BUDGET)}`);
  failed = true;
}
if (totalGzip >= TOTAL_JS_GZIP_BUDGET) {
  console.error(`\nOVER BUDGET: total JS ${kb(totalGzip)} gzip >= ${kb(TOTAL_JS_GZIP_BUDGET)}`);
  failed = true;
}
if (!failed) {
  console.log(
    `\nwithin budget: initial ${kb(initialGzip)}/${kb(INITIAL_GZIP_BUDGET)}, total ${kb(totalGzip)}/${kb(TOTAL_JS_GZIP_BUDGET)} (gzip)`,
  );
}
process.exit(failed ? 1 : 0);
