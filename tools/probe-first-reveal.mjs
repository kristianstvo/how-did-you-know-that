// Probe: first vs second reveal mount on the same page (4x CPU), VT disabled
// so style/layout cost is visible in the Long Animation Frame entries.
import { chromium } from "@playwright/test";
const browser = await chromium.launch({ channel: "msedge", headless: true });
const ctx = await browser.newContext({ viewport: { width: 380, height: 800 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
if (process.argv[2] === "novt") await ctx.addInitScript(() => { delete Document.prototype.startViewTransition; });
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
await page.goto(`http://localhost:3000/#/fixture/caught?as=innocent&t=74000&paused=1&ui=0`);
await page.waitForFunction(() => !!window.__fixture);
await page.waitForTimeout(1500);
const measure = (t) => page.evaluate(async (t) => {
  window.__fixture.seek(t - 1200); window.__fixture.pause();
  await new Promise((r) => setTimeout(r, 1200));
  const entries = [];
  const ob = new PerformanceObserver((l) => entries.push(...l.getEntries()));
  ob.observe({ type: "long-animation-frame", buffered: false });
  window.__fixture.play();
  await new Promise((r) => setTimeout(r, 2500));
  ob.disconnect(); window.__fixture.pause();
  return entries.map((e) => `${Math.round(e.duration)}ms (style+layout ${Math.round(e.styleAndLayoutStart ? e.startTime + e.duration - e.styleAndLayoutStart : 0)}ms)`);
}, t);
const phases = await page.evaluate(() => window.__fixture.phases.filter((p) => p.label.startsWith("reveal")).map((p) => p.t));
console.log("1st reveal mount:", await measure(phases[3]));
console.log("2nd reveal mount:", await measure(phases[4]));
console.log("3rd reveal mount:", await measure(phases[5]));
await browser.close();
