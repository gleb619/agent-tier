import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const publicDir = resolve(__dirname, "../public");
const requiredIcons = [
  "icon-192.png",
  "icon-512.png",
  "icon-maskable-192.png",
  "icon-maskable-512.png",
  "apple-touch-icon.png",
  "favicon-32x32.png",
];

interface ManifestIcon {
  src: string;
  sizes: string;
  type: string;
  purpose?: string;
}

interface ManifestShortcut {
  name: string;
  short_name?: string;
  url: string;
  icons?: ManifestIcon[];
}

interface WebManifest {
  name: string;
  short_name: string;
  start_url: string;
  scope: string;
  display: string;
  theme_color: string;
  background_color: string;
  categories: string[];
  icons: ManifestIcon[];
  shortcuts?: ManifestShortcut[];
}

describe("PWA manifest", () => {
  const manifestPath = resolve(publicDir, "manifest.webmanifest");

  it("has a parseable manifest with required fields", () => {
    expect(existsSync(manifestPath)).toBe(true);
    const manifest: WebManifest = JSON.parse(readFileSync(manifestPath, "utf8"));

    expect(manifest.name).toBeTruthy();
    expect(manifest.short_name).toBeTruthy();
    expect(manifest.start_url).toBe("/");
    expect(manifest.scope).toBe("/");
    expect(manifest.display).toBe("standalone");
    expect(manifest.theme_color).toMatch(/^#[0-9a-fA-F]{6}$/);
    expect(manifest.background_color).toMatch(/^#[0-9a-fA-F]{6}$/);
    expect(manifest.categories).toBeInstanceOf(Array);
    expect(manifest.categories.length).toBeGreaterThan(0);
  });

  it("declares 192 and 512 PNG icons", () => {
    const manifest: WebManifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    const sizes = manifest.icons.map((icon) => icon.sizes);
    expect(sizes).toContain("192x192");
    expect(sizes).toContain("512x512");
  });

  it("declares maskable icons", () => {
    const manifest: WebManifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    const maskables = manifest.icons.filter((icon) => icon.purpose === "maskable");
    expect(maskables.length).toBeGreaterThanOrEqual(2);
    expect(maskables.map((icon) => icon.sizes)).toContain("192x192");
    expect(maskables.map((icon) => icon.sizes)).toContain("512x512");
  });

  it("includes all referenced and required icon files", () => {
    const manifest: WebManifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    const iconSrcs = new Set([...manifest.icons.map((icon) => icon.src.replace(/^\//, "")), ...requiredIcons]);
    for (const src of iconSrcs) {
      expect(existsSync(resolve(publicDir, src))).toBe(true);
    }
  });

  it("declares New Task and Dashboard shortcuts", () => {
    const manifest: WebManifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    const names = (manifest.shortcuts ?? []).map((shortcut) => shortcut.name);
    expect(names).toContain("New Task");
    expect(names).toContain("Dashboard");
    expect(manifest.shortcuts?.find((s) => s.name === "New Task")?.url).toBe("/new");
    expect(manifest.shortcuts?.find((s) => s.name === "Dashboard")?.url).toBe("/");
  });
});

describe("PWA icon files", () => {
  it.each(requiredIcons)("%s exists", (name) => {
    expect(existsSync(resolve(publicDir, name))).toBe(true);
  });
});
