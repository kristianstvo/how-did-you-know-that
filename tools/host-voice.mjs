// The TV host's cue log (v0.19): one period on a big screen, printed as the
// host said it, next to the screens. The teacher (Hana) answers at once,
// three bots fill the class, Hana accuses after the first reveal (so the vote
// lines play), then ends the day. For every answer call: how far its letter
// landed from the moment the answer lit up on the TV.
// A natural teacher lets each show breathe for 2s before moving on; --fast
// moves on the instant they can (the hardest case for a host who must not
// talk over herself). Shows are never skipped.
// Usage (server running, client built): npm run host-voice [-- --fast] [--base http://localhost:3000]
import { chromium } from "@playwright/test";

const arg = (k) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : null);
const base = arg("--base") ?? "http://localhost:3000";
const fast = process.argv.includes("--fast");
const browser = await chromium.launch({ channel: "msedge" }); // Playwright mutes it: nothing reaches the speakers
const errors = [];
const open = async (name, url, viewport, mobile) => {
  const ctx = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`${name}: ${e.message}`));
  await page.goto(url);
  return page;
};
const screenOf = (page) => page.evaluate(() => document.querySelector("#app section")?.className.split(" ").find((c) => c.startsWith("screen-")) ?? "");
const ready = async (page, sel) => {
  const el = page.locator(sel).first();
  return (await el.count()) > 0 && (await el.isVisible().catch(() => false)) && (await el.isEnabled().catch(() => false));
};
const tryClick = async (page, sel) => {
  if (!(await ready(page, sel))) return false;
  await page.locator(sel).first().click({ timeout: 2000 }).catch(() => {});
  return true;
};
/** Click once it has been ready for `ms` (a teacher who lets the room react). */
const since = {};
const clickAfter = async (page, sel, ms) => {
  if (!(await ready(page, sel))) {
    delete since[sel];
    return false;
  }
  since[sel] ??= Date.now();
  if (Date.now() - since[sel] < ms) return false;
  delete since[sel];
  return tryClick(page, sel);
};

// The teacher is the cheater (a local test hook, flagged in the lobby), so the
// accusation sends an innocent to detention and the period runs on.
const host = await open("hana", `${base}/?debugCheater=Hana`, { width: 375, height: 553 }, true);
await host.fill("#playerName", "Hana");
await host.click('[data-action="create"]');
const code = (await host.locator(".roomcode").innerText({ timeout: 15000 })).replace(/\s/g, "");
const tv = await open("tv", `${base}/#/tv/${code}`, { width: 1280, height: 720 }, false);
await tv.waitForSelector(".screen-lobby");
await tv.waitForFunction(() => window.__hdykt?.voiceReady === true, null, { timeout: 30000 });
await tv.keyboard.press("Space"); // someone presses OK on the remote: sound on
for (let i = 0; i < 3; i++) {
  await host.click("#lb-addbot");
  await host.waitForTimeout(150);
}
await host.waitForTimeout(1500);
await host.click("#lb-start");

const pause = fast ? 0 : 2000;
let accused = false;
const t0 = Date.now();
while (Date.now() - t0 < 6 * 60_000) {
  const sc = await screenOf(host);
  if (sc === "screen-matchEnd") break;
  await tryClick(host, "button.opt:not([disabled])");
  if (!accused && sc === "screen-reveal" && (await clickAfter(host, "#rv-accuse.st-go:not([disabled])", pause))) {
    await host.waitForTimeout(600);
    accused = await tryClick(host, "#rv-accuse");
  }
  if (sc === "screen-vote" && (await tryClick(host, ".vo-cell:not([disabled]):not(:has(.vo-you))"))) await tryClick(host, "#vo-go:not([disabled])");
  await clickAfter(host, '#rv-host[data-action="advance"]:not([disabled])', pause);
  await clickAfter(host, "#vr-continue", pause);
  await host.waitForTimeout(200);
}
await tv.waitForSelector(".screen-matchEnd", { timeout: 20000 });
await tv.waitForTimeout(9000); // the report card's lines
await host.waitForSelector("#me-endday", { timeout: 30000 }).catch(() => {});
await tryClick(host, "#me-endday");
await tv.waitForSelector(".screen-sessionEnd", { timeout: 20000 }).catch(() => {});
await tv.waitForTimeout(8000);

const { voice, beats } = await tv.evaluate(() => ({ voice: window.__hdykt.voice ?? [], beats: window.__hdykt.beats }));
const screenOfKey = (k) => k.split("|")[0];
const entries = [];
for (const b of beats) if (!entries.length || screenOfKey(entries.at(-1).key) !== screenOfKey(b.key)) entries.push(b);
const answerLit = new Map(); // reveal screen → when its answer beat rendered
for (const b of beats) {
  const [k, list] = b.key.split("|");
  if (k.startsWith("reveal-") && list.split(",").includes("answer") && !answerLit.has(k)) answerLit.set(k, b.server);
}
const start = Math.min(voice[0]?.at ?? Infinity, entries.find((e) => e.key.startsWith("lobby"))?.server ?? Infinity);
const fmt = (t) => `${((t - start) / 1000).toFixed(1).padStart(6)}s`;
const rows = [
  ...entries.filter((e) => e.server >= start).map((e) => ({ t: e.server, text: `  ── ${screenOfKey(e.key)}` })),
  ...voice.map((v) => {
    let note = v.cut !== undefined ? `✂ cut at ${fmt(v.cut).trim()}` : "";
    if (/^(answer|quick)_/.test(v.id)) {
      const k = [...answerLit.keys()].find((key) => Math.abs(answerLit.get(key) - v.hit) < 5000);
      if (k) note += ` letter ${v.hit - answerLit.get(k) >= 0 ? "+" : ""}${Math.round(v.hit - answerLit.get(k))}ms from the answer lighting up`;
    }
    return { t: v.at, text: `${v.heard ? "🔊" : "🔇"} ${v.id.padEnd(16)} ${note}` };
  }),
].sort((a, b) => a.t - b.t);
for (const r of rows) console.log(`${fmt(r.t)}  ${r.text}`);
const calls = voice.filter((v) => /^(answer|quick)_/.test(v.id));
// One voice at a time: no line may start while another still has words to
// say (a cut line's words stop at its cut, give or take its 25ms fade).
const spoken = voice.filter((v) => v.cut === undefined || v.cut > v.at).sort((a, b) => a.at - b.at);
const overlaps = [];
for (let i = 1; i < spoken.length; i++) {
  const prev = spoken[i - 1];
  const until = Math.min(prev.end, prev.cut ?? Infinity);
  if (spoken[i].at < until - 40) overlaps.push(`${prev.id} → ${spoken[i].id} (${until - spoken[i].at}ms)`);
}
console.log(
  JSON.stringify({
    fast,
    lines: voice.length,
    heard: voice.filter((v) => v.heard).length,
    cut: voice.filter((v) => v.cut !== undefined).map((v) => v.id),
    overlaps,
    reveals: answerLit.size,
    answerCalls: calls.length,
    errors,
  }),
);
await browser.close();
