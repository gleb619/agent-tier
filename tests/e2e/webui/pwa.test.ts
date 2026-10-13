import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Browser, Page } from "playwright";
import { expect as pwExpect } from "playwright/test";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { launchBrowser, newPage, startWeb, type WebE2E, waitForRun } from "./harness";

const webuiDist = path.resolve(__dirname, "..", "..", "..", "src", "webui", "dist");

/** Open a page; newPage already waits until the service worker controls it. */
async function openControlledPage(browser: Browser, baseUrl: string): Promise<Page> {
  return newPage(browser, baseUrl);
}

describe("webui e2e: pwa service worker", () => {
  let web: WebE2E;
  let browser: Browser;

  beforeAll(async () => {
    web = await startWeb();
    browser = await launchBrowser();
  });

  afterAll(async () => {
    try {
      await browser?.close();
    } catch {}
    await web?.close();
  });

  it("registers the service worker, controls the page, and links the manifest", async () => {
    const page = await openControlledPage(browser, web.baseUrl);

    const registration = await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.getRegistration("/");
      return reg ? { scope: reg.scope, state: reg.active?.state ?? null } : null;
    });
    expect(registration).not.toBeNull();
    expect(registration?.state).toBe("activated");

    const manifestHref = await page.locator('link[rel="manifest"]').getAttribute("href");
    expect(manifestHref).toBe("/manifest.webmanifest");
    const manifest = await web.request<{
      name: string;
      display: string;
      start_url: string;
      icons: { src: string; sizes: string }[];
    }>("GET", "/manifest.webmanifest");
    expect(manifest.display).toBe("standalone");
    expect(manifest.icons.some((i) => i.sizes === "192x192")).toBe(true);
    expect(manifest.icons.some((i) => i.sizes === "512x512")).toBe(true);
  });

  it("serves the app shell from the precache when offline", async () => {
    const page = await openControlledPage(browser, web.baseUrl);
    await page.waitForSelector('[data-testid="dashboard-view"]');

    await page.context().setOffline(true);
    try {
      await page.reload({ waitUntil: "domcontentloaded" });
      // Shell renders from precached index.html even with no network.
      await page.waitForSelector('[data-testid="dashboard-view"]');
      const navButtons = page.getByRole("button", { name: "New Task" });
      await pwExpect(navButtons.first()).toBeVisible();
    } finally {
      await page.context().setOffline(false);
    }
  });

  it("queues a run created while offline and replays it when back online", async () => {
    const page = await openControlledPage(browser, web.baseUrl);

    await page.context().setOffline(true);
    let queued: { status: number; body: { ok: boolean; queued: boolean; id: string } };
    try {
      queued = await page.evaluate(async () => {
        const res = await fetch("/api/runs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt: "e2e-offline-queue T25" }),
        });
        return { status: res.status, body: await res.json() };
      });
    } finally {
      await page.context().setOffline(false);
    }

    // The SW answers with 202 + queued:true instead of hitting the network.
    expect(queued.status).toBe(202);
    expect(queued.body).toMatchObject({ ok: true, queued: true });

    // Going back online makes the SW drain the IndexedDB queue → run created.
    const run = await waitForRun(web, (r) => r.prompt === "e2e-offline-queue T25", { timeoutMs: 30_000 });
    expect(run.status).not.toBe("failed");

    // The page also hears about it (RUN_QUEUED / RUN_REPLAYED toasts).
    await pwExpect(page.locator('[data-testid="toast"]').first()).toContainText(/queued|started/i);
  });

  it("deep links render their view directly, including while offline", async () => {
    // Server-side SPA fallback on a cold load.
    const page = await newPage(browser, `${web.baseUrl}/settings`);
    await page.waitForSelector('[data-testid="settings-view"]');

    // newPage already waited for SW control (the controllerchange reload
    // keeps the /settings URL). Go offline and re-navigate.
    await page.context().setOffline(true);
    try {
      await page.goto(`${web.baseUrl}/settings`, { waitUntil: "domcontentloaded" });
      await page.waitForSelector('[data-testid="settings-view"]');
    } finally {
      await page.context().setOffline(false);
    }
  });

  it("detects a service-worker update and swaps on Reload (SKIP_WAITING)", async () => {
    // Serve a writable copy of dist so we can bump sw.js mid-test.
    const distCopy = mkdtempSync(path.join(os.tmpdir(), "at-webui-pwa-dist-"));
    cpSync(webuiDist, distCopy, { recursive: true });
    const web2 = await startWeb({ staticDir: distCopy });
    try {
      const page = await openControlledPage(browser, web2.baseUrl);

      // Bump the SW script → byte-diff → updatefound on the next update check.
      // The server prefers precompressed .br/.gz siblings, so drop them — a
      // stale sibling would mask the byte-diff (T24 precompression).
      const swPath = path.join(distCopy, "sw.js");
      rmSync(`${swPath}.br`, { force: true });
      rmSync(`${swPath}.gz`, { force: true });
      writeFileSync(swPath, `${readFileSync(swPath, "utf8")}\n// e2e-update-marker\n`);

      await page.evaluate(async () => {
        const reg = await navigator.serviceWorker.getRegistration("/");
        await reg?.update();
      });

      // The app surfaces "Update available" with a Reload action.
      const toast = page.locator('[data-testid="toast"]', { hasText: "Update available" });
      await toast.waitFor();
      await toast.getByRole("button", { name: "Reload" }).click();

      // SKIP_WAITING → activate → controllerchange reload → new SW in control.
      await page.waitForFunction(async () => {
        const text = await (await fetch("/sw.js")).text();
        return text.includes("e2e-update-marker") && navigator.serviceWorker.controller !== null;
      });
      const state = await page.evaluate(async () => {
        const reg = await navigator.serviceWorker.getRegistration("/");
        return reg?.active?.state ?? null;
      });
      expect(state).toBe("activated");
    } finally {
      await web2.close();
      rmSync(distCopy, { recursive: true, force: true });
    }
  }, 60_000);
});
