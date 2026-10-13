import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import { collectPreloadSet, findEntryScript, injectPreloadHints, isCompressible, perf } from "../plugins/perf";

describe("findEntryScript", () => {
  it("extracts the module script src", () => {
    const html = `<html><body><script type="module" crossorigin src="/assets/index-aB3xYz99.js"></script></body></html>`;
    expect(findEntryScript(html)).toBe("assets/index-aB3xYz99.js");
  });

  it("returns null when no module script", () => {
    expect(findEntryScript("<html></html>")).toBeNull();
  });
});

describe("collectPreloadSet", () => {
  const assets = new Map([
    ["assets/index-aaaa.js", `import "./chunk-bbbb.js";\nimport { x } from "./deep/cccc.js";\nconsole.log(x);`],
    ["assets/chunk-bbbb.js", `import "./deep/cccc.js";\nexport const y = 1;`],
    ["assets/deep/cccc.js", "export const x = 1;"],
    ["assets/DashboardView-dddd.js", `import "./deep/cccc.js";`],
  ]);

  it("includes the entry and direct imports at depth 1", () => {
    const set = collectPreloadSet(assets, "assets/index-aaaa.js", 1);
    expect(set).toEqual(new Set(["assets/index-aaaa.js", "assets/chunk-bbbb.js", "assets/deep/cccc.js"]));
  });

  it("stops at depth 0 (entry only)", () => {
    expect(collectPreloadSet(assets, "assets/index-aaaa.js", 0)).toEqual(new Set(["assets/index-aaaa.js"]));
  });

  it("ignores missing files and import cycles", () => {
    const cyclic = new Map([
      ["assets/a.js", `import "./b.js";`],
      ["assets/b.js", `import "./a.js";`],
    ]);
    const set = collectPreloadSet(cyclic, "assets/a.js", 5);
    expect(set).toEqual(new Set(["assets/a.js", "assets/b.js"]));
  });
});

describe("injectPreloadHints", () => {
  it("inserts modulepreload and prefetch links after <head>", () => {
    const out = injectPreloadHints("<html><head><title>x</title></head></html>", ["a.js"], ["b.js"]);
    expect(out).toContain('<link rel="modulepreload" crossorigin href="/a.js" />');
    expect(out).toContain('<link rel="prefetch" href="/b.js" />');
    expect(out.indexOf("<head>")).toBeLessThan(out.indexOf('rel="modulepreload"'));
  });

  it("returns html unchanged when there is nothing to inject", () => {
    const html = "<html></html>";
    expect(injectPreloadHints(html, [], [])).toBe(html);
  });
});

describe("isCompressible", () => {
  it.each([
    ["index.html", true],
    ["assets/app.js", true],
    ["assets/app.css", true],
    ["icon.svg", true],
    ["manifest.webmanifest", true],
    ["icon.png", false],
    ["icon-192.png", false],
  ])("%s -> %s", (file, expected) => {
    expect(isCompressible(file)).toBe(expected);
  });
});

describe("perf plugin closeBundle", () => {
  let dir: string | null = null;
  afterEach(() => {
    dir = null;
  });

  async function makeDist(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), "at-perf-"));
    const dist = join(root, "dist");
    await mkdir(join(dist, "assets"), { recursive: true });
    await writeFile(
      join(dist, "index.html"),
      `<html><head><title>at</title></head><body>` +
        `<script type="module" crossorigin src="/assets/index-aaaa.js"></script></body></html>`,
    );
    await writeFile(join(dist, "assets", "index-aaaa.js"), `import "./chunk-bbbb.js";\nconsole.log(1);`);
    await writeFile(join(dist, "assets", "chunk-bbbb.js"), "export const y = 1;");
    await writeFile(join(dist, "assets", "DashboardView-cccc.js"), "export const v = 1;");
    await writeFile(join(dist, "icon.png"), "png-bytes");
    return dist;
  }

  async function runPlugin(dist: string): Promise<void> {
    dir = dist;
    const plugin = perf({ outDir: dist });
    const hook = plugin.closeBundle as { handler: () => Promise<void> } | (() => Promise<void>);
    await (typeof hook === "function" ? hook.call(plugin) : hook.handler.call(plugin));
  }

  it("injects modulepreload for entry graph and prefetch for lazy chunks", async () => {
    const dist = await makeDist();
    await runPlugin(dist);
    const html = await readFile(join(dist, "index.html"), "utf8");
    expect(html).toContain('<link rel="modulepreload" crossorigin href="/assets/index-aaaa.js" />');
    expect(html).toContain('<link rel="modulepreload" crossorigin href="/assets/chunk-bbbb.js" />');
    expect(html).toContain('<link rel="prefetch" href="/assets/DashboardView-cccc.js" />');
  });

  it("writes .br and .gz for text assets only", async () => {
    const dist = await makeDist();
    await runPlugin(dist);
    const js = await readFile(join(dist, "assets", "index-aaaa.js"), "utf8");
    const br = await readFile(join(dist, "assets", "index-aaaa.js.br"));
    const gz = await readFile(join(dist, "assets", "index-aaaa.js.gz"));
    expect(br.length).toBeGreaterThan(0);
    expect(gunzipSync(gz).toString()).toBe(js);
    // png is not compressible
    await expect(readFile(join(dist, "icon.png.br"))).rejects.toThrow();
  });
});
