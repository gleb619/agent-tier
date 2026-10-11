import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { Browser, Page } from "playwright";
import { expect as pwExpect } from "playwright/test";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { launchBrowser, newPage, normkaPrompt, startWeb, type WebE2E, waitForRun } from "./harness";

describe("webui e2e: create task", () => {
  let web: WebE2E;
  let browser: Browser;

  beforeAll(async () => {
    web = await startWeb();
    browser = await launchBrowser();
  });

  afterAll(async () => {
    await browser.close();
    await web.close();
  });

  it("submits a tier-4 mock run with #NORMKA and sees it complete", async () => {
    const page: Page = await newPage(browser, web.baseUrl);

    await page.getByRole("button", { name: "New Task" }).click();
    await page.waitForSelector('[data-testid="new-task-view"]');

    const markerPath = path.join(web.stateDir, "e2e-marker.txt");
    await page.locator('[data-testid="prompt-input"]').fill(normkaPrompt(markerPath));

    // Agent list is loaded async from /api/agents; wait for the mock option
    // (<option> elements are reported hidden while the select is closed).
    await page.waitForSelector('select#agent option[value="mock"]', { state: "attached" });
    await page.locator("select#tier").selectOption("4");
    await page.locator("select#agent").selectOption("mock");

    await page.getByRole("button", { name: "Start run" }).click();
    await pwExpect(page.locator('[data-testid="toast"]').first()).toContainText("Run started");

    // The detached run records itself asynchronously and finishes fast; the
    // recorded prompt carries the normka spec (marker path identifies it).
    const run = await waitForRun(web, (r) => r.prompt.includes("e2e-marker.txt") && r.status === "done");
    expect(run.agent).toBe("mock");
    expect(run.tier).toBe(4);
    expect(existsSync(markerPath)).toBe(true);
    expect(readFileSync(markerPath, "utf8")).toBe("T14 e2e");

    // The completed run shows up in the sidebar run list (live via /api/events
    // refetch — the run was started after the page loaded its (empty) list).
    const items = page.locator('[data-testid="run-list"] [data-testid="run-item"]');
    await items.waitFor();
    expect(await items.count()).toBe(1);
  });
});
