// PARITY: the cheater's phone must look and move exactly like an innocent's.
// Method: render the SAME seat twice at the same frozen instant of a recorded
// match — once with its real secret (it is the cheater), once with the secret
// masked (?mask=1, the counterfactual innocent) — and diff every element's
// box, opacity, transform and running animations. The only sanctioned
// differences: the question's faint corner dot (.cheat-mark) and the role
// line's text (same length, same box).
import { expect, test, type Browser, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";

interface Tape {
  t0: number;
  cheaterId: string;
  frames: { t: number; state: { phase: string; phaseStartedAt: number; match: { questionIdx: number; reveal: { startedAt: number } | null } | null } }[];
}

/** Playheads worth checking: question entry/mid/urgent, every reveal beat,
 *  vote, vote result beats, match-end beats, role beats. */
function playheads(name: string): number[] {
  const tape = JSON.parse(readFileSync(`client/public/fixtures/${name}.json`, "utf8")) as Tape;
  const out = new Set<number>();
  let prev = "";
  for (const f of tape.frames) {
    const s = f.state;
    const key = `${s.phase}:${s.match?.questionIdx ?? ""}`;
    if (key === prev) continue;
    prev = key;
    const start = s.phaseStartedAt - tape.t0;
    const add = (ms: number) => out.add(Math.round(start + ms));
    if (s.phase === "role") [400, 1100, 1800, 3000, 4400].forEach(add); // v0.27: 4400 = period 1's longer bell
    if (s.phase === "question") [300, 900, 6000, 11000].forEach(add);
    if (s.phase === "reveal") [100, 900, 1900, 2600, 3400, 4100, 4900, 6300, 7200, 9000].forEach(add);
    if (s.phase === "vote") [600, 4000, 7000].forEach(add); // v0.23: the floor, then ballots open
    if (s.phase === "voteResult") [300, 1500, 3500, 6000].forEach(add);
    if (s.phase === "matchEnd") [200, 1000, 2000, 3000, 4500, 6200, 7500].forEach(add);
  }
  return [...out].sort((a, b) => a - b);
}

async function snapshot(page: Page) {
  return page.evaluate(() => {
    // Motion is compared by its SPECIFICATION — each element's computed
    // animation and transition timing — which is deterministic at a frozen
    // playhead. (Sampling live Animation objects instead compares how far two
    // separate browser processes happen to have progressed: real-time noise.)
    const inApp = (a: Animation) => {
      const t = (a.effect as KeyframeEffect | null)?.target as Element | null;
      return !!t && !!t.closest?.("#app");
    };
    const anims: string[] = [];
    // Settle motion deterministically: finite animations to their end,
    // infinite loops pinned at 0 — then compare the resulting layout.
    for (const a of document.getAnimations().filter(inApp)) {
      const it = (a.effect as KeyframeEffect).getTiming().iterations;
      if (it === Infinity) {
        a.pause();
        a.currentTime = 0;
      } else a.finish();
    }
    const els = [...document.querySelectorAll("#app *")] as HTMLElement[];
    const items = els.map((el, i) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      const cls = [...el.classList].filter((c) => c !== "cheat-mark").sort().join(".");
      return {
        i,
        sig: `${el.tagName}#${el.id}.${cls}`,
        marked: el.classList.contains("cheat-mark"),
        box: [r.x, r.y, r.width, r.height].map((v) => Math.round(v * 2) / 2).join(","),
        opacity: cs.opacity,
        transform: cs.transform,
        visibility: cs.visibility,
        textLen: el.children.length === 0 ? (el.textContent ?? "").length : -1,
        motion: `${cs.animationName}|${cs.animationDuration}|${cs.animationDelay}|${cs.animationIterationCount}|${cs.transitionProperty}|${cs.transitionDuration}|${cs.transitionDelay}`,
      };
    });
    for (const it of items) if (it.motion.split("|")[0] !== "none") anims.push(`${it.sig}:${it.motion}`);
    return { items, anims, phase: document.querySelector("#app section")?.className ?? "" };
  });
}

async function open(browser: Browser, url: string) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(url);
  await page.waitForFunction(() => !!window.__fixture);
  await page.waitForTimeout(700);
  return { ctx, page };
}

for (const name of ["caught", "graduated", "topscore", "detention", "struckout"]) {
  test(`parity: cheater vs masked cheater — ${name}`, async ({ browser }) => {
    const times = playheads(name);
    // Open both at the same moment so their entrance animations have equal age.
    const [real, masked] = await Promise.all([
      open(browser, `/#/fixture/${name}?as=cheater&t=0&paused=1&ui=0`),
      open(browser, `/#/fixture/${name}?as=cheater&mask=1&t=0&paused=1&ui=0`),
    ]);
    const failures: string[] = [];
    let markersSeen = 0;
    for (const t of times) {
      await Promise.all([real.page, masked.page].map((p) => p.evaluate((ms) => window.__fixture!.seek(ms), t)));
      await Promise.all([real.page, masked.page].map((p) => p.waitForTimeout(450)));
      const [a, b] = await Promise.all([snapshot(real.page), snapshot(masked.page)]);
      if (a.items.length !== b.items.length) {
        failures.push(`t=${t} ${a.phase}: element count ${a.items.length} vs ${b.items.length}`);
        continue;
      }
      for (let i = 0; i < a.items.length; i++) {
        const x = a.items[i];
        const y = b.items[i];
        if (x.marked) markersSeen++;
        const textOk = x.textLen === y.textLen;
        if (x.sig !== y.sig || x.box !== y.box || x.opacity !== y.opacity || x.transform !== y.transform || x.visibility !== y.visibility || !textOk || x.motion !== y.motion) {
          failures.push(`t=${t} ${a.phase.slice(0, 40)}: ${x.sig} box ${x.box}|${y.box} op ${x.opacity}|${y.opacity} tf ${x.transform}|${y.transform} text ${x.textLen}|${y.textLen} motion ${x.motion}|${y.motion}`);
        }
      }
      const aa = a.anims.join("\n");
      const bb = b.anims.join("\n");
      if (aa !== bb) {
        const onlyA = a.anims.filter((x) => !b.anims.includes(x));
        const onlyB = b.anims.filter((x) => !a.anims.includes(x));
        failures.push(`t=${t} ${a.phase.slice(0, 40)}: running animations differ\n  only cheater: ${onlyA.join(" | ")}\n  only masked: ${onlyB.join(" | ")}`);
      }
    }
    await real.ctx.close();
    await masked.ctx.close();
    console.log(`${name}: ${times.length} instants checked, cheat-mark seen on ${markersSeen} element-instants, ${failures.length} differences`);
    expect(markersSeen, "the sanctioned marker should appear during questions").toBeGreaterThan(0);
    expect(failures, failures.slice(0, 12).join("\n")).toEqual([]);
  });
}

/** v0.27: the held 📝 note lives outside #app: its paper and its two lines. */
async function peekSnapshot(page: Page) {
  return page.evaluate(() =>
    [...document.querySelectorAll("#note-peek, #note-peek *")].map((el) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return {
        sig: `${el.tagName}#${el.id}.${[...el.classList].sort().join(".")}`,
        box: [r.x, r.y, r.width, r.height].map((v) => Math.round(v * 2) / 2).join(","),
        look: `${cs.opacity}|${cs.transform}|${cs.visibility}|${cs.transitionProperty}|${cs.transitionDuration}`,
        textLen: el.children.length === 0 ? (el.textContent ?? "").length : -1,
      };
    }),
  );
}

// v0.27: the ⭐ sheet's 📝 row is the same on every seat, and held, the note
// behind it is the same paper in the same place: only its line's words differ
// (same length, same two lines). The ⭐ tab's dot never shows in a replay;
// nothing about the role feeds it (main.ts noteCheck).
test("parity: the ⭐ sheet's 📝 row and the note held behind it — cheater vs masked cheater", async ({ browser }) => {
  const tape = JSON.parse(readFileSync("client/public/fixtures/caught.json", "utf8")) as Tape;
  const start = (phase: string, q: number) => tape.frames.find((f) => f.state.phase === phase && f.state.match?.questionIdx === q)!.state.phaseStartedAt - tape.t0;
  const [real, masked] = await Promise.all([
    open(browser, `/#/fixture/caught?as=cheater&t=0&paused=1&ui=0`),
    open(browser, `/#/fixture/caught?as=cheater&mask=1&t=0&paused=1&ui=0`),
  ]);
  const both = [real.page, masked.page];
  const failures: string[] = [];
  let rows = 0;
  for (const t of [start("question", 0) + 4000, start("reveal", 3) + 9000].map(Math.round)) {
    await Promise.all(both.map((p) => p.evaluate((ms) => window.__fixture!.seek(ms), t)));
    await Promise.all(both.map((p) => p.waitForTimeout(450)));
    await Promise.all(both.map((p) => p.click(".sess-tab")));
    await Promise.all(both.map((p) => p.waitForTimeout(700)));
    const [a, b] = await Promise.all(both.map(snapshot));
    rows += a.items.filter((x) => x.sig.startsWith("BUTTON#sheet-note")).length;
    if (a.items.length !== b.items.length) failures.push(`t=${t} sheet: element count ${a.items.length} vs ${b.items.length}`);
    else {
      for (let i = 0; i < a.items.length; i++) {
        const [x, y] = [a.items[i], b.items[i]];
        if (x.sig !== y.sig || x.box !== y.box || x.opacity !== y.opacity || x.transform !== y.transform || x.visibility !== y.visibility || x.textLen !== y.textLen || x.motion !== y.motion) {
          failures.push(`t=${t} sheet: ${x.sig} box ${x.box}|${y.box} op ${x.opacity}|${y.opacity} text ${x.textLen}|${y.textLen}`);
        }
      }
    }
    // Held: the note shows on both phones, the same paper.
    await Promise.all(both.map((p) => p.locator("#sheet-note").dispatchEvent("pointerdown")));
    await Promise.all(both.map((p) => p.waitForTimeout(400)));
    const [pa, pb] = await Promise.all(both.map(peekSnapshot));
    if (pa.length !== 3 || pa.length !== pb.length) failures.push(`t=${t} note: ${pa.length} vs ${pb.length} elements (want 3)`);
    else pa.forEach((x, i) => JSON.stringify(x) !== JSON.stringify(pb[i]) && failures.push(`t=${t} note: ${JSON.stringify(x)} vs ${JSON.stringify(pb[i])}`));
    await Promise.all(both.map((p) => p.locator("#sheet-note").dispatchEvent("pointerup")));
    await Promise.all(both.map((p) => p.click('.overlay .sheet [data-action="toggleBoard"]')));
  }
  await real.ctx.close();
  await masked.ctx.close();
  expect(rows, "the 📝 row was in the sheet at both instants").toBe(2);
  expect(failures, failures.slice(0, 12).join("\n")).toEqual([]);
});
