import type { Browser, Page } from "playwright";
import { expect as pwExpect } from "playwright/test";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type ApiRun, launchBrowser, newPage, normkaPrompt, startWeb, type WebE2E, waitForRun } from "./harness";

describe("webui e2e: run details log", () => {
  let web: WebE2E;
  let browser: Browser;
  let run: ApiRun;

  beforeAll(async () => {
    web = await startWeb();
    browser = await launchBrowser();
    // Seed a completed run through the real API (spawns the real CLI + mock).
    await web.request("POST", "/api/runs", {
      prompt: normkaPrompt(`${web.stateDir}/e2e-details-marker.txt`),
      agent: "mock",
      tier: 4,
    });
    run = await waitForRun(web, (r) => r.prompt.includes("e2e-details-marker.txt") && r.status === "done");
  });

  afterAll(async () => {
    await browser.close();
    await web.close();
  });

  it("opens the run from the sidebar and shows meta + log output", async () => {
    const page: Page = await newPage(browser, web.baseUrl);

    await page.waitForSelector('[data-testid="run-item"]');
    await page.locator('[data-testid="run-item"]', { hasText: "mock" }).first().click();

    await page.waitForSelector('[data-testid="run-details-view"]');
    await pwExpect(page.locator('[data-testid="run-meta"]')).toBeVisible();

    await page.getByRole("button", { name: "Show prompt" }).click();
    await pwExpect(page.locator('[data-testid="run-prompt"]')).toContainText("#NORMKA");

    // The lorem step's stdout is served via /api/runs/:id/log.
    const log = page.locator('[data-testid="log-viewer"]');
    await pwExpect(log).toBeVisible();
    await pwExpect(log).toContainText("Lorem ipsum", { timeout: 15_000 });
    expect(run.status).toBe("done");
  });
});
