import type { Browser, Page } from "playwright";
import { expect as pwExpect } from "playwright/test";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { launchBrowser, newPage, startWeb, type WebE2E } from "./harness";

describe("webui e2e: settings persist", () => {
  let web: WebE2E;
  let browser: Browser;

  beforeAll(async () => {
    web = await startWeb();
    browser = await launchBrowser();
  });

  afterAll(async () => {
    // beforeAll may have thrown between startWeb and launchBrowser; closing
    // must still reach the server so no orphan `at web` (or temp dir) leaks.
    try {
      await browser?.close();
    } catch {}
    await web?.close();
  });

  it("saves defaults to the server and survives a reload", async () => {
    const page: Page = await newPage(browser, web.baseUrl);

    await page.getByRole("button", { name: "Settings" }).click();
    await page.waitForSelector('[data-testid="settings-view"]');

    await page.locator("select#default-tier").selectOption("3");
    await page.getByRole("button", { name: "Save settings" }).click();
    await pwExpect(page.locator('[data-testid="toast"]').first()).toContainText("Settings saved");

    // Server-side state (temp AT_STATE_DIR/web-settings.json).
    const settings = await web.request<Record<string, unknown>>("GET", "/api/settings");
    expect(settings.defaultTier).toBe(3);

    // Reload → form re-initializes from the backend.
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-testid="settings-view"]');
    expect(await page.locator("select#default-tier").inputValue()).toBe("3");
  });
});
