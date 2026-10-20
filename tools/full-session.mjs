// Plays one whole session in a phone-sized browser, start to finish: Practice
// with bots, a 5-second timer, the host taps through every screen (answers,
// Next, hand-ins, Continue), then "End the day". Screenshots each new screen
// and fails on any console error. A smoke test of the full flow.
// Usage (server running): node tools/full-session.mjs [--base http://localhost:3000]
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const base = process.argv.includes("--base") ? process.argv[process.argv.indexOf("--base") + 1] : "http://localhost:3000";
const out = "capture/full-session";
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: "msedge" });
const ctx = await browser.newContext({ viewport: { width: 375, height: 553 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const errors = [];
let throttled = 0; // the online question API rate-limits (HTTP 429); the game falls back to its own pack
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => {
  if (m.type() !== "error") return;
  if (/status of 429/.test(m.text())) throttled++;
  else errors.push(m.text());
});

await page.goto(base);
await page.fill("#playerName", "Teach");
await page.click("#hm-practice");
await page.waitForSelector(".screen-lobby");
await page.click("#lb-adv summary"); // the custom timer lives under Advanced (v0.10)
await page.fill("#set-timer", "5");
await page.locator("#set-timer").dispatchEvent("change");
await page.click("#lb-start");

const seen = new Set();
const t0 = Date.now();
let endedDay = false;
while (Date.now() - t0 < 6 * 60_000) {
  const screen = await page.evaluate(() => document.querySelector("#app section")?.className.split(" ").find((c) => c.startsWith("screen-")) ?? "");
  const key = `${screen}`;
  if (!seen.has(key)) {
    seen.add(key);
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${out}/${seen.size}-${screen}.png` });
  }
  if (screen === "screen-sessionEnd") {
    await page.waitForSelector("#se-share", { timeout: 15000 });
    await page.screenshot({ path: `${out}/${seen.size + 1}-sessionEnd-done.png`, fullPage: true });
    break;
  }
  const click = async (sel) => {
    const el = page.locator(sel).first();
    if ((await el.count()) && (await el.isEnabled().catch(() => false)) && (await el.isVisible().catch(() => false))) {
      await el.click().catch(() => {});
      return true;
    }
    return false;
  };
  if (await click("button.opt:not([disabled])")) continue;
  if (screen === "screen-vote") {
    if (await click(".vo-cell:not([disabled]):not(:has(.vo-you))")) await click("#vo-go:not([disabled])");
  }
  if (await click("#rv-host:not([disabled])")) {
    await page.waitForTimeout(300);
    continue;
  }
  if (await click("#vr-continue")) continue;
  if (!endedDay && screen === "screen-matchEnd" && (await click("#me-endday"))) {
    endedDay = true;
    continue;
  }
  await page.waitForTimeout(250);
}
const yearbook = await page.evaluate(() => [...document.querySelectorAll("#se-yearbook .me-aw-row")].map((r) => r.textContent?.replace(/\s+/g, " ").trim()));
// Your report card (v0.12): a fresh tab on the same phone remembers the day.
const home = await ctx.newPage();
await home.goto(base);
await home.waitForTimeout(800);
const reportCard = await home.evaluate(() => document.querySelector("#hm-record .hm-rec-sum")?.textContent ?? "(no report card)");
console.log(JSON.stringify({ screens: [...seen], yearbook, reportCard, errors, throttledQuestionFetches: throttled, seconds: Math.round((Date.now() - t0) / 1000) }, null, 1));
await browser.close();
process.exit(errors.length || !seen.has("screen-sessionEnd") ? 1 : 0);
