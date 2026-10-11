import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "..");
const WEBUI = path.join(ROOT, "src", "webui");

function read(...parts: string[]): string {
  return readFileSync(path.join(...parts), "utf8");
}

function readJson<T>(...parts: string[]): T {
  return JSON.parse(read(...parts)) as T;
}

describe("webui scaffold (T5)", () => {
  it("has a self-contained package at src/webui", () => {
    const pkg = readJson<{ name: string; type: string; private?: boolean; scripts: Record<string, string> }>(
      WEBUI,
      "package.json",
    );
    expect(pkg.name).toBe("agent-tier-webui");
    expect(pkg.type).toBe("module");
    expect(pkg.private).toBe(true);
    for (const script of ["dev", "build", "preview", "check", "test"]) {
      expect(pkg.scripts[script], `script ${script}`).toBeTruthy();
    }
  });

  it("declares Vite + Svelte + Tailwind dependencies", () => {
    const pkg = readJson<{ devDependencies: Record<string, string>; dependencies: Record<string, string> }>(
      WEBUI,
      "package.json",
    );
    expect(pkg.devDependencies.svelte).toMatch(/^\^4\./);
    expect(pkg.devDependencies.vite).toMatch(/^\^5\./);
    expect(pkg.devDependencies["@sveltejs/vite-plugin-svelte"]).toBeTruthy();
    expect(pkg.devDependencies.tailwindcss).toBeTruthy();
    expect(pkg.devDependencies.postcss).toBeTruthy();
    expect(pkg.devDependencies.autoprefixer).toBeTruthy();
    expect(pkg.devDependencies["svelte-check"]).toBeTruthy();
    expect(pkg.dependencies["lucide-svelte"]).toBeTruthy();
  });

  it("has a root tsconfig.webui.json extending the root tsconfig", () => {
    const cfg = readJson<{
      extends: string;
      include: string[];
      exclude?: string[];
      compilerOptions: { noEmit: boolean };
    }>(ROOT, "tsconfig.webui.json");
    expect(cfg.extends).toBe("./tsconfig.json");
    expect(cfg.include).toContain("src/webui/**/*");
    expect(cfg.compilerOptions.noEmit).toBe(true);
  });

  it("excludes src/webui from the root tsc build", () => {
    const cfg = readJson<{ exclude: string[] }>(ROOT, "tsconfig.json");
    expect(cfg.exclude).toContain("src/webui");
  });

  it("configures Vite with Svelte, aliases, port 3000 and /api proxy", () => {
    const vite = read(WEBUI, "vite.config.ts");
    expect(vite).toContain("@sveltejs/vite-plugin-svelte");
    expect(vite).toContain("src/webui");
    for (const alias of ["$components", "$stores", "$types", "$utils"]) {
      expect(vite).toContain(`${alias}:`);
    }
    expect(vite).toContain("port: 3000");
    expect(vite).toContain('"/api"');
  });

  it("configures Tailwind to scan the webui tree with a light theme", () => {
    const tailwind = read(WEBUI, "tailwind.config.js");
    expect(tailwind).toContain("./components/**/*.{svelte,ts}");
    expect(tailwind).toContain("./App.svelte");
    expect(tailwind).toContain("darkMode: false");
    expect(tailwind).toContain("content:");
    expect(existsSync(path.join(WEBUI, "postcss.config.js"))).toBe(true);
  });

  it("has an HTML entry wired to a Svelte entrypoint and global styles", () => {
    const html = read(WEBUI, "index.html");
    expect(html).toContain('id="app"');
    expect(html).toContain("./main.ts");
    expect(existsSync(path.join(WEBUI, "main.ts"))).toBe(true);
    expect(existsSync(path.join(WEBUI, "App.svelte"))).toBe(true);
    expect(existsSync(path.join(WEBUI, "styles", "tailwind.css"))).toBe(true);
  });

  it("defines the core types from the design doc", () => {
    const run = read(WEBUI, "types", "run.ts");
    expect(run).toContain("export type RunStatus");
    expect(run).toContain("export interface Run ");
    expect(run).toContain("export interface RunMetadata");
    expect(run).toContain("export interface RunConfig");
    const index = read(WEBUI, "types", "index.ts");
    expect(index).toContain("export type ViewType");
    expect(index).toContain("export interface SSEEvent");
    expect(read(WEBUI, "types", "agent.ts")).toContain("export interface Agent");
    expect(read(WEBUI, "types", "settings.ts")).toContain("export interface Settings");
    expect(read(WEBUI, "types", "dashboard.ts")).toContain("export interface DashboardStats");
  });

  it("wires web scripts into the root package.json", () => {
    const pkg = readJson<{ scripts: Record<string, string> }>(ROOT, "package.json");
    expect(pkg.scripts["web:dev"]).toContain("src/webui");
    expect(pkg.scripts["web:build"]).toContain("src/webui");
    expect(pkg.scripts["web:check"]).toContain("src/webui");
  });
});
