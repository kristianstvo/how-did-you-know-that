// Phone audit: measures every screen at realistic VISIBLE viewport sizes (the
// part of the screen left once the browser's own bars are drawn), with touch
// and mobile emulation, from recorded fixture replays frozen at exact moments.
//
// Per screen × phone it records: sideways overflow, how many screens of
// scrolling the page needs, whether each primary control is fully visible
// without scrolling and how far down the screen it sits (thumb reach), tap
// targets under 44px, text under 12px, inputs under 16px (iOS zooms the page
// when one is focused) and the fixed 🎓 tab covering content. It also drives
// two interaction probes: scroll carried across a screen change, and a
// double-tap on ACCUSE. Screenshots go next to the report for review.
//
// Usage (server must already serve the built client):
//   node tools/phone-audit.mjs [--label before] [--base http://localhost:3000]
// Output: capture/phone/<label>/{report.json, REPORT.md, <phone>/<moment>.png}
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith("--")) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith("--") ? all[i + 1] : "true"]);
    return acc;
  }, []),
);
const LABEL = args.label ?? "before";
const BASE = args.base ?? "http://localhost:3000";
const OUT = path.join(ROOT, "capture", "phone", LABEL);
fs.mkdirSync(OUT, { recursive: true });

// Visible CSS viewports with the browser UI showing (portrait unless noted).
const PHONES = [
  { id: "se1-safari", w: 320, h: 460, note: "iPhone SE (1st gen), Safari bars shown" },
  { id: "se3-safari", w: 375, h: 553, note: "iPhone SE 2/3 · 8, Safari bars shown" },
  { id: "galaxy-chrome", w: 360, h: 640, note: "Galaxy A / S (360×740), Chrome" },
  { id: "iphone15-safari", w: 393, h: 659, note: "iPhone 15, Safari bars shown" },
  { id: "pixel-chrome", w: 412, h: 780, note: "Pixel 7/8, Chrome" },
  { id: "promax-safari", w: 430, h: 739, note: "iPhone Pro Max, Safari bars shown" },
  { id: "landscape", w: 760, h: 330, note: "iPhone held sideways, Safari" },
];

const tapes = new Map();
const tape = (name) => {
  if (!tapes.has(name)) tapes.set(name, JSON.parse(fs.readFileSync(path.join(ROOT, "client/public/fixtures", `${name}.json`), "utf8")));
  return tapes.get(name);
};
/** Playhead of a phase's beat 0 (first occurrence, or of question qi). */
function phaseAt(name, phase, qi) {
  const t = tape(name);
  const f = t.frames.find((x) => x.state.phase === phase && (qi === undefined || x.state.match?.questionIdx === qi));
  if (!f) throw new Error(`no ${phase} in ${name}`);
  return Math.round(f.state.phaseStartedAt - t.t0);
}

// Moments, each with the controls that matter on that screen.
const fx = (name, view, t, extra = "") => `${BASE}/#/fixture/${name}?as=${view}&t=${t}&paused=1&ui=0${extra}`;
const MOMENTS = [
  { id: "home", url: `${BASE}/`, primary: ["#playerName", '[data-action="join"]', '[data-action="create"]'] },
  { id: "home-invited", url: `${BASE}/#/join/ABCDE`, primary: ["#playerName", '[data-action="join"]'] },
  { id: "lobby-host-10", url: fx("fullclass", "innocent", -1500, "&host=1"), primary: ["#lb-start", "#lb-share"] },
  { id: "lobby-guest-6", url: fx("caught", "innocent", -1500), primary: [".lb-wait"] },
  { id: "role", url: fx("caught", "innocent", phaseAt("caught", "role") + 2400), primary: [] },
  { id: "question-6", url: fx("caught", "innocent", phaseAt("caught", "question", 4) + 3000), primary: [".opt", ".qz-count"] },
  { id: "question-10", url: fx("fullclass", "innocent", phaseAt("fullclass", "question", 7) + 3000), primary: [".opt", ".qz-count"] },
  { id: "reveal-armed-6-host", url: fx("caught", "innocent", phaseAt("caught", "reveal", 3) + 9500, "&host=1"), primary: ["#rv-accuse", "#rv-host", ".board"] },
  { id: "reveal-armed-10", url: fx("fullclass", "innocent", phaseAt("fullclass", "reveal", 4) + 9500), primary: ["#rv-accuse", ".board"] },
  { id: "vote-10", url: fx("fullclass", "innocent", phaseAt("fullclass", "vote") + 3000), primary: [".vo-cell", ".vo-num"] },
  { id: "vote-6", url: fx("caught", "innocent", phaseAt("caught", "vote") + 3000), primary: [".vo-cell", ".vo-num"] },
  { id: "voteResult-10-host", url: fx("fullclass", "innocent", phaseAt("fullclass", "voteResult") + 7000, "&host=1"), primary: ['[data-action="advance"]'] },
  { id: "matchEnd-10-host", url: fx("fullclass", "innocent", phaseAt("fullclass", "matchEnd") + 7000, "&host=1"), primary: ['[data-action="advance"]'] },
  { id: "matchEnd-6-guest", url: fx("caught", "innocent", phaseAt("caught", "matchEnd") + 7000), primary: [] },
];

function measure() {
  const vw = innerWidth;
  const vh = innerHeight;
  const doc = document.documentElement;
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none" && Number(cs.opacity) > 0.05;
  };
  const desc = (el) => `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}${[...el.classList].slice(0, 2).map((c) => `.${c}`).join("")}`;
  const srOnly = (el) => !!el.closest(".sr-only, .hm-sr, .lb-sr, .qz-sr");

  const smallTargets = [];
  for (const el of document.querySelectorAll("#app button, #app a[href], #app input, #app summary, #app [data-action], #app select")) {
    if (!visible(el) || srOnly(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 44 || r.height < 44) smallTargets.push(`${desc(el)} ${Math.round(r.width)}×${Math.round(r.height)}`);
  }
  const smallText = new Map();
  const walker = document.createTreeWalker(document.getElementById("app"), NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const el = n.parentElement;
    if (!el || !n.textContent.trim() || srOnly(el) || !visible(el)) continue;
    const fs = parseFloat(getComputedStyle(el).fontSize);
    if (fs < 12) {
      const k = `${desc(el)} ${fs.toFixed(1)}px`;
      smallText.set(k, (smallText.get(k) ?? 0) + 1);
    }
  }
  const smallInputs = [...document.querySelectorAll("#app input, #app textarea, #app select")]
    .filter((el) => visible(el) && parseFloat(getComputedStyle(el).fontSize) < 16)
    .map((el) => `${desc(el)} ${getComputedStyle(el).fontSize}`);

  // The fixed 🎓 tab: does it sit on top of any text?
  let tabCovers = [];
  const tab = document.querySelector(".sess-tab");
  if (tab && visible(tab)) {
    const tr = tab.getBoundingClientRect();
    for (const el of document.querySelectorAll("#app *")) {
      if (el === tab || tab.contains(el) || el.contains(tab) || !visible(el) || el.children.length || !el.textContent.trim()) continue;
      const r = el.getBoundingClientRect();
      if (r.right > tr.left + 2 && r.left < tr.right - 2 && r.bottom > tr.top + 2 && r.top < tr.bottom - 2) tabCovers.push(desc(el));
    }
  }
  return {
    vw,
    vh,
    overflowX: doc.scrollWidth > doc.clientWidth + 1,
    scrollScreens: +(doc.scrollHeight / vh).toFixed(2),
    smallTargets,
    smallText: [...smallText].map(([k, c]) => `${k} ×${c}`),
    smallInputs,
    tabCovers,
  };
}

function primaries(selectors) {
  // The fold is the top of any bar pinned to the bottom of the screen (a
  // control hidden behind the Hand-in dock is not visible), else the edge.
  const pinned = [...document.querySelectorAll("#app *")].filter((el) => {
    const cs = getComputedStyle(el);
    if (cs.position !== "sticky" && cs.position !== "fixed") return false;
    const r = el.getBoundingClientRect();
    return r.height > 0 && r.bottom >= innerHeight - 2 && r.top > innerHeight / 2;
  });
  const out = [];
  for (const sel of selectors) {
    const els = [...document.querySelectorAll(sel)].filter((el) => el.getBoundingClientRect().height > 0);
    if (!els.length) {
      out.push({ sel, found: false });
      continue;
    }
    const rs = els.map((el) => el.getBoundingClientRect());
    const docks = pinned.filter((d) => !els.some((el) => d.contains(el) || el.contains(d)));
    const vh = Math.min(innerHeight, ...docks.map((d) => d.getBoundingClientRect().top + 12)); // 12px: the dock's fade
    const top = Math.min(...rs.map((r) => r.top));
    const bottom = Math.max(...rs.map((r) => r.bottom));
    const allVisible = rs.every((r) => r.top >= 0 && r.bottom <= vh + 0.5);
    const hidden = rs.filter((r) => r.bottom > vh + 0.5).length;
    // Thumb reach: where the control's centre sits, as a share of screen height
    // (0 = top edge, 1 = bottom edge). One-handed, the lower half is easy.
    const reach = rs.map((r) => +(((r.top + r.bottom) / 2) / innerHeight).toFixed(2));
    out.push({ sel, found: true, count: els.length, allVisible, belowFold: hidden, top: Math.round(top), bottom: Math.round(bottom), reach: [Math.min(...reach), Math.max(...reach)] });
  }
  return out;
}

const browser = await chromium.launch({ channel: "msedge", headless: true });
const report = { label: LABEL, base: BASE, at: new Date().toISOString(), phones: PHONES, results: [], probes: {} };

for (const phone of PHONES) {
  const ctx = await browser.newContext({ viewport: { width: phone.w, height: phone.h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  for (const m of MOMENTS) {
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(m.url);
    if (m.url.includes("/fixture/")) await page.waitForFunction(() => !!window.__fixture);
    await page.waitForTimeout(900);
    // Finish entrance animations so layout is final.
    await page.evaluate(() => document.getAnimations().forEach((a) => (a.effect?.getTiming().iterations === Infinity ? a.pause() : a.finish())));
    await page.waitForTimeout(100);
    const met = await page.evaluate(measure);
    const prim = await page.evaluate(primaries, m.primary);
    const dir = path.join(OUT, phone.id);
    fs.mkdirSync(dir, { recursive: true });
    await page.screenshot({ path: path.join(dir, `${m.id}.png`) });
    report.results.push({ phone: phone.id, moment: m.id, ...met, primaries: prim, errors });
    await page.close();
  }
  await ctx.close();
}

// ---- Probe 1: scroll carried across a screen change (reveal → vote) ----
{
  const ctx = await browser.newContext({ viewport: { width: 375, height: 553 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const tReveal = phaseAt("fullclass", "vote") - 2500; // the reveal just before the vote
  await page.goto(fx("fullclass", "innocent", tReveal));
  await page.waitForFunction(() => !!window.__fixture);
  await page.waitForTimeout(800);
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const before = await page.evaluate(() => scrollY);
  await page.evaluate((t) => window.__fixture.seek(t), phaseAt("fullclass", "vote") + 2500);
  await page.waitForTimeout(900);
  const after = await page.evaluate(() => {
    const st = document.querySelector("#vo-stamp")?.getBoundingClientRect();
    const clock = document.querySelector(".vo-num")?.getBoundingClientRect();
    return { scrollY, stampVisible: !!st && st.top >= 0 && st.bottom <= innerHeight, timerVisible: !!clock && clock.top >= 0 && clock.bottom <= innerHeight };
  });
  report.probes.scrollCarry = { scrolledTo: before, ...after };
  await ctx.close();
}

// ---- Probe 2: a double-tap on ACCUSE in a live room (host + 3 bots) ----
{
  const ctx = await browser.newContext({ viewport: { width: 375, height: 553 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/`);
  await page.fill("#playerName", "Tapper");
  await page.click('[data-action="create"]');
  await page.waitForSelector("#lb-addbot");
  for (let i = 0; i < 3; i++) {
    await page.click("#lb-addbot");
    await page.waitForTimeout(150);
  }
  await page.click("#lb-start");
  await page.waitForSelector("button.opt:not([disabled])", { timeout: 30000 });
  await page.click("button.opt");
  await page.waitForSelector("#rv-host", { timeout: 40000 });
  await page.click("#rv-host"); // Skip the show to the accuse beat
  await page.waitForSelector("#rv-accuse.st-go:not([disabled])", { timeout: 15000 });
  const box = await page.locator("#rv-accuse").boundingBox();
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.touchscreen.tap(x, y);
  await page.waitForTimeout(90);
  await page.touchscreen.tap(x, y);
  await page.waitForTimeout(1200);
  report.probes.doubleTapAccuse = { voteStarted: await page.evaluate(() => !!document.querySelector(".screen-vote")) };
  await ctx.close();
}

await browser.close();

// ---- Report ----
const lines = [`# Phone audit — ${LABEL}`, "", `${report.at} · ${BASE}`, ""];
lines.push("| Phone | Viewport | Note |", "|---|---|---|", ...PHONES.map((p) => `| ${p.id} | ${p.w}×${p.h} | ${p.note} |`), "");
const byMoment = new Map();
for (const r of report.results) {
  if (!byMoment.has(r.moment)) byMoment.set(r.moment, []);
  byMoment.get(r.moment).push(r);
}
for (const [moment, rs] of byMoment) {
  lines.push(`## ${moment}`, "", "| Phone | Scroll (screens) | Overflow | Primary controls (visible? · reach) | <44px targets | <12px text | Inputs <16px | Tab covers |", "|---|---|---|---|---|---|---|---|");
  for (const r of rs) {
    const prim = r.primaries.map((p) => (p.found ? `${p.sel}${p.count > 1 ? `×${p.count}` : ""} ${p.allVisible ? "✓" : `✗ ${p.belowFold} below`} · ${p.reach.join("–")}` : `${p.sel} —`)).join("<br>");
    lines.push(`| ${r.phone} | ${r.scrollScreens} | ${r.overflowX ? "**yes**" : "no"} | ${prim || "—"} | ${r.smallTargets.length ? r.smallTargets.slice(0, 4).join("<br>") + (r.smallTargets.length > 4 ? `<br>+${r.smallTargets.length - 4}` : "") : "0"} | ${r.smallText.length ? r.smallText.slice(0, 3).join("<br>") + (r.smallText.length > 3 ? `<br>+${r.smallText.length - 3}` : "") : "0"} | ${r.smallInputs.join("<br>") || "0"} | ${r.tabCovers.join(", ") || "—"} |`);
  }
  lines.push("");
}
lines.push("## Probes", "", "```json", JSON.stringify(report.probes, null, 2), "```", "");
fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify(report, null, 1));
fs.writeFileSync(path.join(OUT, "REPORT.md"), lines.join("\n"));
console.log(`wrote ${path.relative(ROOT, OUT)}/REPORT.md (${report.results.length} screen×phone checks)`);
console.log(JSON.stringify(report.probes));
