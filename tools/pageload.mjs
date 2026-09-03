#!/usr/bin/env node
/* Real page-load measurement (spec 10.1).

   Opens the production build in headless Chromium with the network throttled
   to a broadband profile and to a 3G profile (Chrome DevTools Protocol
   emulation), and measures what the spec asks about: the time until the
   first screen is interactive — the sign-in form present and enabled —
   plus DOMContentLoaded, load, and first contentful paint from the browser's
   own timing API. This is the browser's measurement, not the server's.

   Requires a Chromium: PLAYWRIGHT_BROWSERS_PATH or CHROME_PATH, or a
   `npx playwright install chromium` in CI.

   Usage: node tools/pageload.mjs [--base http://localhost:4188] [--json]
   Exported: measure(base, profile) and PROFILES for the check. */

import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
/* playwright-core is a devDependency of the web package; resolve it from there. */
const { chromium } = createRequire(resolve("app/web/package.json"))("playwright-core");

export const PROFILES = {
  broadband: { downloadThroughput: 10 * 1024 * 1024 / 8, uploadThroughput: 5 * 1024 * 1024 / 8, latency: 20, budgetMs: 2000 },
  "3g":      { downloadThroughput: 400 * 1024 / 8, uploadThroughput: 400 * 1024 / 8, latency: 400, budgetMs: 5000 }
};

export function findChromium() {
  if (process.env.CHROME_PATH && existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
  const roots = [process.env.PLAYWRIGHT_BROWSERS_PATH, join(process.env.HOME || "", ".cache/ms-playwright")].filter(Boolean);
  for (const root of roots) {
    if (!existsSync(root)) continue;
    for (const d of readdirSync(root)) {
      for (const cand of [join(root, d, "chrome-linux", "chrome"), join(root, d, "chrome-linux64", "chrome"), join(root, d, "chrome"), join(root, "chromium")]) {
        if (existsSync(cand)) return cand;
      }
    }
    if (existsSync(join(root, "chromium"))) return join(root, "chromium");
  }
  return null;
}

export async function measure(base, profileName, { runs = 2 } = {}) {
  const profile = PROFILES[profileName];
  const exe = findChromium();
  if (!exe) throw new Error("no Chromium found: set CHROME_PATH or PLAYWRIGHT_BROWSERS_PATH, or run `npx playwright install chromium`");
  const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
  try {
    const results = [];
    for (let i = 0; i < runs; i++) {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
      const page = await context.newPage();
      const cdp = await context.newCDPSession(page);
      await cdp.send("Network.enable");
      await cdp.send("Network.emulateNetworkConditions", { offline: false, ...profile });
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: profileName === "3g" ? 4 : 1 });
      const t0 = Date.now();
      await page.goto(base + "/", { waitUntil: "commit" });
      /* Interactive: the first screen's primary control exists and is enabled. */
      await page.waitForSelector("input#em:not([disabled]), .gcard, .who", { timeout: 60_000 });
      const interactive = Date.now() - t0;
      const timing = await page.evaluate(() => {
        const nav = performance.getEntriesByType("navigation")[0];
        const fcp = performance.getEntriesByName("first-contentful-paint")[0];
        return { domContentLoaded: Math.round(nav.domContentLoadedEventEnd), load: Math.round(nav.loadEventEnd),
                 fcp: fcp ? Math.round(fcp.startTime) : null, transferBytes: performance.getEntriesByType("resource").reduce((a, r) => a + (r.transferSize || 0), nav.transferSize || 0) };
      });
      results.push({ interactiveMs: interactive, ...timing });
      await context.close();
    }
    /* Report the median run so one cold start does not decide. */
    results.sort((a, b) => a.interactiveMs - b.interactiveMs);
    const median = results[Math.floor(results.length / 2)];
    return { profile: profileName, budgetMs: profile.budgetMs, ...median, withinBudget: median.interactiveMs <= profile.budgetMs, runs: results };
  } finally { await browser.close(); }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const base = args.includes("--base") ? args[args.indexOf("--base") + 1] : "http://localhost:4188";
  const out = {};
  for (const p of Object.keys(PROFILES)) out[p] = await measure(base, p);
  if (args.includes("--json")) console.log(JSON.stringify(out, null, 2));
  else for (const [p, r] of Object.entries(out))
    console.log(`${p.padEnd(9)} interactive ${r.interactiveMs}ms (budget ${r.budgetMs}ms) FCP ${r.fcp}ms load ${r.load}ms transfer ${Math.round(r.transferBytes / 1024)}KB ${r.withinBudget ? "OK" : "OVER BUDGET"}`);
  process.exit(Object.values(out).every(r => r.withinBudget) ? 0 : 1);
}
