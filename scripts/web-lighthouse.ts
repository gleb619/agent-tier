#!/usr/bin/env ts-node
/**
 * Lighthouse gate for the WebUI prod build (T25).
 * Usage: pnpm run web:lighthouse
 *
 * Boots `at web` on a random port against src/webui/dist, then:
 *   1. Runs Lighthouse (desktop preset) and asserts the thresholds from
 *      scripts/lighthouse.config.json (performance >= 0.9).
 *   2. Asserts PWA installability via scripts/pwa-installable.ts
 *      (Lighthouse 13 removed its PWA category).
 *
 * Exits 0 when both gates pass, 1 otherwise. Chrome is resolved from
 * CHROME_PATH, or the Playwright-installed chromium.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import { startWeb } from "../tests/e2e/webui/harness";
import { evaluateGate, formatGateResult, type LhrLike, type LighthouseGateConfig } from "./lighthouse-gate";
import { checkInstallable } from "./pwa-installable";

interface GateConfig extends LighthouseGateConfig {
  preset?: "desktop" | "default";
  chromeFlags?: string[];
  onlyCategories?: string[];
}

const projectRoot = process.cwd();
const configPath = path.join(projectRoot, "scripts", "lighthouse.config.json");
const webuiDist = path.join(projectRoot, "src", "webui", "dist");

function loadConfig(): GateConfig {
  if (!existsSync(configPath)) throw new Error(`config not found: ${configPath}`);
  return JSON.parse(readFileSync(configPath, "utf8")) as GateConfig;
}

function resolveChromePath(): string {
  if (process.env.CHROME_PATH && existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
  const p = chromium.executablePath();
  if (existsSync(p)) return p;
  throw new Error(
    "no Chrome found: set CHROME_PATH or install Playwright chromium (pnpm exec playwright install chromium)",
  );
}

type LhrLikeFull = LhrLike & { audits: Record<string, { displayValue?: string } | undefined> };

async function main(): Promise<number> {
  const config = loadConfig();

  if (!existsSync(path.join(webuiDist, "index.html")) || !existsSync(path.join(webuiDist, "sw.js"))) {
    console.error(`WebUI prod build missing in ${webuiDist} — run: pnpm run web:build`);
    return 1;
  }

  const web = await startWeb();
  try {
    // 1. PWA installability (manifest + icons + service worker).
    const installable = await checkInstallable(web.baseUrl, (url) => fetch(url));
    console.log("PWA installability:");
    for (const check of installable.checks) console.log(`  ok   ${check}`);
    for (const failure of installable.failures) console.log(`  FAIL ${failure}`);

    // 2. Lighthouse performance.
    const chromePath = resolveChromePath();
    // Lighthouse is ESM-only; node >= 22 can require() ESM.
    const lighthouse = (require("lighthouse") as typeof import("lighthouse")).default;
    // The Lighthouse Node API does not launch Chrome itself: start it with chrome-launcher
    // (Playwright's chromium) and hand Lighthouse the debugging port. Always kill it after.
    const { launch } = require("chrome-launcher") as typeof import("chrome-launcher");
    const chrome = await launch({
      chromePath,
      chromeFlags: config.chromeFlags ?? ["--headless=new", "--no-sandbox"],
    });
    let lhr: LhrLikeFull;
    try {
      const flags = {
        output: "json" as const,
        port: chrome.port,
        onlyCategories: config.onlyCategories ?? ["performance"],
      };
      const preset =
        config.preset === "desktop" ? (await import("lighthouse/core/config/desktop-config.js")).default : undefined;
      const result = await lighthouse(web.baseUrl, flags, preset);
      if (!result) throw new Error("lighthouse returned no result");
      lhr = result.lhr as unknown as LhrLikeFull;
    } finally {
      chrome.kill();
    }

    console.log(`\nLighthouse (${config.preset ?? "default"} preset):`);
    const gate = evaluateGate(lhr as unknown as LhrLike, {
      categories: config.categories,
      audits: config.audits,
    });
    console.log(formatGateResult(gate));
    console.log(
      `  key metrics: FCP ${lhr.audits["first-contentful-paint"]?.displayValue ?? "?"}, ` +
        `LCP ${lhr.audits["largest-contentful-paint"]?.displayValue ?? "?"}, ` +
        `TBT ${lhr.audits["total-blocking-time"]?.displayValue ?? "?"}, ` +
        `CLS ${lhr.audits["cumulative-layout-shift"]?.displayValue ?? "?"}`,
    );

    const reportPath = path.join(tmpdir(), "at-webui-lighthouse-report.json");
    writeFileSync(reportPath, JSON.stringify(lhr, null, 2));
    console.log(`\nfull report: ${reportPath}`);

    const ok = installable.ok && gate.ok;
    console.log(ok ? "\nLighthouse gate: PASS" : "\nLighthouse gate: FAIL");
    return ok ? 0 : 1;
  } finally {
    // Lighthouse kills the Chrome it launched; close the web server we booted.
    await web.close();
  }
}

// Imported as a module (tests) vs executed directly.
main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
