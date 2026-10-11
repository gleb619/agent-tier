import type { Browser, Page } from "playwright";
import { expect as pwExpect } from "playwright/test";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type ApiRun, launchBrowser, newPage, normkaPrompt, startWeb, type WebE2E, waitForRun } from "./harness";

describe("webui e2e: run list filter", () => {
  let web: WebE2E;
  let browser: Browser;
  let runs: ApiRun[];

  beforeAll(async () => {
    web = await startWeb();
    browser = await launchBrowser();
    // Two completed runs seeded through the real API; runId prefixes identify
    // them in the UI filter (name/prompt are identical for both).
    runs = [];
    for (const name of ["e2e-filter-a", "e2e-filter-b"]) {
      await web.request("POST", "/api/runs", {
        prompt: normkaPrompt(`${web.stateDir}/${name}.txt`),
        agent: "mock",
        tier: 4,
      });
      runs.push(await waitForRun(web, (r) => r.prompt.includes(`${name}.txt`) && r.status === "done"));
    }
  });

  afterAll(async () => {
    await browser.close();
    await web.close();
  });

  it("narrows the run list by runId token", async () => {
    const page: Page = await newPage(browser, web.baseUrl);

    // Scope to the sidebar list: the dashboard (default view) renders the same
    // RunItem component for recent completions and would double every count.
    const items = page.locator('[data-testid="run-list"] [data-testid="run-item"]');
    await page.waitForSelector('[data-testid="run-list"] [data-testid="run-item"]');
    expect(await items.count()).toBe(2);

    const filter = page.locator("#run-filter");
    await filter.fill(runs[0].runId.slice(0, 8));
    await pwExpect(items).toHaveCount(1);

    await filter.fill("");
    await pwExpect(items).toHaveCount(2);

    await filter.fill("no-such-token");
    await pwExpect(items).toHaveCount(0);
  });
});
