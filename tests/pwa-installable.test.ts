import { describe, expect, it } from "vitest";
import { checkInstallable } from "../scripts/pwa-installable";

const PNG = new TextEncoder().encode("png").buffer as ArrayBuffer;

function okResponse(body: string, contentType = "text/html"): ReturnType<typeof makeRes> {
  return makeRes(body, 200, contentType);
}

function makeRes(
  body: string | ArrayBuffer,
  status: number,
  contentType: string,
): {
  ok: boolean;
  status: number;
  headers: { get(n: string): string | null };
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
} {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (n) => (n.toLowerCase() === "content-type" ? contentType : null) },
    text: () => Promise.resolve(typeof body === "string" ? body : ""),
    arrayBuffer: () => Promise.resolve(typeof body === "string" ? new ArrayBuffer(0) : body),
  };
}

const HTML = '<html><head><link rel="manifest" href="/manifest.webmanifest" /></head></html>';
const MANIFEST = JSON.stringify({
  name: "at",
  short_name: "at",
  start_url: "/",
  display: "standalone",
  icons: [
    { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
    { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
  ],
});
const SW = 'self.addEventListener("fetch", () => {}); const c = caches.open("x");';

/** Fetch stub serving a healthy app by default; override per-path. */
function server(overrides: Record<string, ReturnType<typeof makeRes> | Error> = {}) {
  const routes: Record<string, ReturnType<typeof makeRes>> = {
    "http://x/": okResponse(HTML),
    "http://x/manifest.webmanifest": okResponse(MANIFEST, "application/manifest+json"),
    "http://x/icon-192.png": makeRes(PNG, 200, "image/png"),
    "http://x/icon-512.png": makeRes(PNG, 200, "image/png"),
    "http://x/sw.js": okResponse(SW, "text/javascript"),
  };
  return async (url: string) => {
    const hit = overrides[url] ?? routes[url];
    if (hit instanceof Error) throw hit;
    return hit ?? makeRes("not found", 404, "text/plain");
  };
}

describe("checkInstallable", () => {
  it("passes on a healthy app", async () => {
    const result = await checkInstallable("http://x", server());
    expect(result.failures).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.checks.length).toBeGreaterThanOrEqual(5);
  });

  it("fails when index.html lacks a manifest link", async () => {
    const result = await checkInstallable("http://x", server({ "http://x/": okResponse("<html></html>") }));
    expect(result.ok).toBe(false);
    expect(result.failures.join("\n")).toContain('rel="manifest"');
  });

  it("fails on a browser-tab display mode", async () => {
    const manifest = JSON.stringify({ ...JSON.parse(MANIFEST), display: "browser" });
    const result = await checkInstallable(
      "http://x",
      server({ "http://x/manifest.webmanifest": okResponse(manifest, "application/json") }),
    );
    expect(result.ok).toBe(false);
    expect(result.failures.join("\n")).toContain('display "browser"');
  });

  it("fails when the 512px icon is missing from the manifest", async () => {
    const manifest = JSON.stringify({
      ...JSON.parse(MANIFEST),
      icons: [{ src: "/icon-192.png", sizes: "192x192", type: "image/png" }],
    });
    const result = await checkInstallable(
      "http://x",
      server({ "http://x/manifest.webmanifest": okResponse(manifest, "application/json") }),
    );
    expect(result.ok).toBe(false);
    expect(result.failures.join("\n")).toContain("512px icon");
  });

  it("fails when an icon does not serve an image", async () => {
    const result = await checkInstallable(
      "http://x",
      server({ "http://x/icon-512.png": makeRes("oops", 500, "text/plain") }),
    );
    expect(result.ok).toBe(false);
    expect(result.failures.join("\n")).toContain("icon /icon-512.png");
  });

  it("fails when sw.js has no fetch handler", async () => {
    const result = await checkInstallable(
      "http://x",
      server({ "http://x/sw.js": okResponse("// nothing", "text/javascript") }),
    );
    expect(result.ok).toBe(false);
    expect(result.failures.join("\n")).toContain("no fetch handler");
  });

  it("fails when the server is down", async () => {
    const result = await checkInstallable("http://x", async () => {
      throw new Error("ECONNREFUSED");
    });
    expect(result.ok).toBe(false);
  });
});
