// Game night: the whole product at once, the way a real evening goes.
// Three phones (teacher Hana, Bea, Cy), two bots and a big screen on one relay:
//   · period 1: everyone answers; after the first reveal Cy accuses, the class
//     votes, the result plays, the period runs to its report card
//   · period 2: the teacher's page reloads on the first question and takes the class
//     back (v0.14); the period runs to its report card
//   · End the day → graduation on every screen → New day → homeroom
//   · the big screen (v0.16) follows every phase; nobody hits a page error
//   · the big screen's host (v0.19) voices both periods; the phones stay silent
// Usage (server running): node tools/game-night.mjs [--base http://localhost:3000]
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const base = process.argv.includes("--base") ? process.argv[process.argv.indexOf("--base") + 1] : "http://localhost:3000";
const out = "capture/game-night";
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: "msedge" });
const errors = [];
const pages = {};
const open = async (name, url, viewport = { width: 375, height: 553 }, mobile = true) => {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`${name}: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error" && !/status of 429/.test(m.text())) errors.push(`${name}: ${m.text()}`);
  });
  page.on("dialog", (d) => void d.accept()); // the teacher's "Leave site?" on reload
  await page.goto(url);
  pages[name] = page;
  return page;
};
const screenOf = (page) => page.evaluate(() => document.querySelector("#app section")?.className.split(" ").find((c) => c.startsWith("screen-")) ?? "");
const tryClick = async (page, sel) => {
  const el = page.locator(sel).first();
  if ((await el.count()) && (await el.isVisible().catch(() => false)) && (await el.isEnabled().catch(() => false))) {
    await el.click({ timeout: 2000 }).catch(() => {});
    return true;
  }
  return false;
};
const seen = {};
const note = async () => {
  for (const [name, page] of Object.entries(pages)) {
    const sc = await screenOf(page).catch(() => "");
    if (sc) (seen[name] ??= new Set()).add(sc);
  }
};
const checks = [];
const check = (ok, what) => {
  checks.push({ ok, what });
  console.log(`${ok ? "✓" : "✗"} ${what}`);
};

// ---- Homeroom ----
const host = await open("hana", base);
await host.fill("#playerName", "Hana");
await host.click('[data-action="create"]');
const code = (await host.locator(".roomcode").innerText({ timeout: 15000 })).replace(/\s/g, "");
for (const name of ["Bea", "Cy"]) {
  const p = await open(name.toLowerCase(), `${base}/#/join/${code}`);
  await p.fill("#playerName", name);
  await p.click('[data-action="join"]');
  await p.waitForSelector(".screen-lobby");
}
const tv = await open("tv", `${base}/#/tv/${code}`, { width: 1280, height: 720 }, false);
await tv.waitForSelector(".screen-lobby");
for (let i = 0; i < 2; i++) {
  await host.click("#lb-addbot");
  await host.waitForTimeout(150);
}
await host.click("#lb-adv summary");
await host.fill("#set-timer", "6");
await host.locator("#set-timer").dispatchEvent("change");
check((await tv.locator(".lb-row").count()) === 5, "the big screen sees the class: 3 people + 2 bots, and not itself");

// ---- A period: answer everything; the teacher advances; one accusation ----
const players = () => [pages.hana, pages.bea, pages.cy];
async function playPeriod(period, { accuseAfterFirstReveal = false, reloadAtQuestion = -1 } = {}) {
  let accused = !accuseAfterFirstReveal;
  let reloaded = reloadAtQuestion < 0;
  const t0 = Date.now();
  while (Date.now() - t0 < 5 * 60_000) {
    await note();
    const sc = await screenOf(pages.hana);
    if (sc === "screen-matchEnd") {
      if (!reloaded) check(false, `period ${period}: the teacher's page was reloaded at Q${reloadAtQuestion}`);
      return true;
    }
    if (!reloaded && sc === "screen-question") {
      const qn = await pages.hana.locator(".qz-qn b").innerText().catch(() => "");
      if (qn === `Q${reloadAtQuestion}`) {
        await pages.hana.reload();
        await pages.hana.waitForSelector(".screen-question, .screen-reveal", { timeout: 20000 });
        check((await pages.hana.locator(".screen-home").count()) === 0, `period ${period}: the teacher's reload at Q${reloadAtQuestion} lands back in the period, not on Home`);
        reloaded = true;
      }
    }
    for (const p of players()) await tryClick(p, "button.opt:not([disabled])");
    if (!accused && (await screenOf(pages.cy)) === "screen-reveal" && (await tryClick(pages.cy, "#rv-accuse.st-go:not([disabled])"))) {
      await pages.cy.waitForTimeout(600); // a deliberate confirm, not a fumble
      await tryClick(pages.cy, "#rv-accuse");
      accused = true;
    }
    for (const p of players()) {
      if ((await screenOf(p)) === "screen-vote" && (await tryClick(p, ".vo-cell:not([disabled]):not(:has(.vo-you))"))) await tryClick(p, "#vo-go:not([disabled])");
    }
    await tryClick(pages.hana, "#rv-host:not([disabled])");
    await tryClick(pages.hana, "#vr-continue");
    await pages.hana.waitForTimeout(250);
  }
  return false;
}

await host.click("#lb-start");
check(await playPeriod(1, { accuseAfterFirstReveal: true }), "period 1 reaches its report card (with an accusation and a vote)");
await note();
check(seen.tv?.has("screen-vote") && seen.tv?.has("screen-voteResult"), "the big screen showed the vote and its result");
for (const name of ["bea", "cy", "tv"]) await pages[name].waitForSelector(".screen-matchEnd", { timeout: 20000 }).catch(() => {});
check((await Promise.all(["bea", "cy", "tv"].map((n) => screenOf(pages[n])))).every((s) => s === "screen-matchEnd"), "every screen reaches period 1's report card");
await pages.hana.screenshot({ path: `${out}/1-matchEnd-hana.png` });
await tv.screenshot({ path: `${out}/1-matchEnd-tv.png` });

// ---- Period 2, with a reload of the teacher's page mid-question ----
await pages.hana.waitForSelector("#me-advance", { timeout: 30000 });
await pages.hana.click("#me-advance");
await pages.hana.waitForSelector(".screen-lobby");
await pages.hana.click("#lb-start");
check(await playPeriod(2, { reloadAtQuestion: 1 }), "period 2 reaches its report card after the teacher's reload");
await pages.hana.waitForSelector(".me-rc-row", { timeout: 15000 }).catch(() => {}); // rows land on the scores beat
check((await pages.hana.locator(".me-rc-row").count()) === 5, "…with the same class of five");

// ---- End of the day, and a new one ----
await pages.hana.waitForSelector("#me-endday", { timeout: 30000 });
await pages.hana.click("#me-endday");
for (const name of ["hana", "bea", "cy", "tv"]) await pages[name].waitForSelector(".screen-sessionEnd", { timeout: 20000 }).catch(() => {});
check((await Promise.all(Object.values(pages).map((p) => screenOf(p)))).every((s) => s === "screen-sessionEnd"), "End the day: graduation on every screen, the big screen too");
await pages.hana.waitForSelector("#se-again", { timeout: 20000 });
// A TV can't scroll: graduation day rolls by itself once its show has landed (v0.18).
await tv.waitForTimeout(12000);
check((await tv.evaluate(() => scrollY)) > 0, "the big screen rolls graduation day by itself");
await pages.bea.screenshot({ path: `${out}/2-sessionEnd-bea.png`, fullPage: true });
await tv.screenshot({ path: `${out}/2-sessionEnd-tv.png` });
await pages.hana.click("#se-again");
for (const name of ["hana", "bea", "cy", "tv"]) await pages[name].waitForSelector(".screen-lobby", { timeout: 20000 }).catch(() => {});
check((await Promise.all(Object.values(pages).map((p) => screenOf(p)))).every((s) => s === "screen-lobby"), "New day: everyone back in homeroom, same room");
check((await pages.bea.locator(".lb-row").count()) === 5, "…with the same class of five");

// v0.19: the big screen's host voiced the evening, and only the big screen.
const said = await tv.evaluate(() => (window.__hdykt.voice ?? []).map((v) => v.id));
const hosted = ["period_first", "period_next", "se_crown"].every((id) => said.includes(id)) && said.some((id) => /^(answer|quick)_/.test(id));
check(hosted, `the big screen's host opened both periods, called answers and crowned the day (${said.length} lines)`);
const phoneLines = await Promise.all(["hana", "bea", "cy"].map((n) => pages[n].evaluate(() => (window.__hdykt.voice ?? []).length)));
check(phoneLines.every((n) => n === 0), "…and no phone said a word");

await note();
const phases = Object.fromEntries(Object.entries(seen).map(([k, v]) => [k, [...v].sort()]));
check(errors.length === 0, `no page errors on any of the four screens${errors.length ? `: ${errors.slice(0, 3).join(" | ")}` : ""}`);
console.log(JSON.stringify({ code, phases, errors }, null, 1));
await browser.close();
process.exit(checks.every((c) => c.ok) ? 0 : 1);
