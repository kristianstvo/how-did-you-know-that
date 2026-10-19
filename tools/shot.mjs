// Screenshot helper for design work: renders the app (usually a fixture
// replay frozen at an exact playhead) in headless Edge at phone size.
//   node tools/shot.mjs --url "http://localhost:5181/#/fixture/caught?as=innocent&t=80000&paused=1&ui=0" \
//        --out capture/shots/reveal/high.png [--reduced] [--width 380] [--height 800] [--wait 600] [--cpu 4] [--full]
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith("--")) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith("--") ? all[i + 1] : "true"]);
    return acc;
  }, []),
);
if (!args.url || !args.out) {
  console.error("usage: node tools/shot.mjs --url <url> --out <png> [--reduced] [--width 380] [--height 800] [--wait 600] [--cpu 4] [--full]");
  process.exit(2);
}
const browser = await chromium.launch({ channel: "msedge", headless: true });
const ctx = await browser.newContext({
  viewport: { width: Number(args.width ?? 380), height: Number(args.height ?? 800) },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  reducedMotion: args.reduced ? "reduce" : "no-preference",
});
const page = await ctx.newPage();
if (args.cpu) {
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: Number(args.cpu) });
}
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
await page.goto(args.url);
await page.waitForTimeout(Number(args.wait ?? 600));
mkdirSync(dirname(args.out), { recursive: true });
await page.screenshot({ path: args.out, fullPage: args.full === "true" });
const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
console.log(JSON.stringify({ out: args.out, overflowX: overflow, errors }));
await browser.close();
