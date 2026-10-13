import type { Browser, Page } from "playwright";
import { expect as pwExpect } from "playwright/test";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { launchBrowser, newPage, startWeb, type WebE2E } from "./harness";

describe("webui e2e: dashboard", () => {
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

  it("renders quick stats and agents panel against a live server", async () => {
    const page: Page = await newPage(browser, web.baseUrl);
    await page.waitForSelector('[data-testid="dashboard-view"]');

    // QuickStats tiles reflect the (empty) run store. They render only after
    // the /api/stats fetch resolves — wait for one before counting.
    await page.waitForSelector('[data-testid="stat-tile"]');
    const tiles = await page.locator('[data-testid="stat-tile"]').count();
    expect(tiles).toBeGreaterThanOrEqual(4);

    // AgentsPanel lists the registry (mock is always present).
    await page.waitForSelector('[data-testid="agent-mock"]');
    expect(await page.locator('[data-testid^="agent-"]').count()).toBeGreaterThan(1);

    // Shell chrome.
    await pwExpect(page.locator('[data-testid="status-bar"]')).toBeVisible();
  });
});
