// ACCESSIBILITY: reduced motion is opacity-only with identical beat timing;
// correctness is readable without colour; tap targets ≥44px; no horizontal
// overflow at 380px. Colour-vision screenshots are saved for human review.
import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { mkdirSync } from "node:fs";

// Moments derived from the recorded fixtures (never hard-coded times).
interface TapeState {
  phase: string;
  phaseStartedAt: number;
  match: {
    questionIdx: number;
    reveal?: { lastBell: string[]; callout?: { kind: string } | null } | null;
    voteResult?: { banishedId: string | null; wasCheater: boolean } | null;
  } | null;
}
interface Tape {
  t0: number;
  frames: { t: number; state: TapeState }[];
}

const cache = new Map<string, Tape>();
const tape = (name: string): Tape => {
  if (!cache.has(name)) cache.set(name, JSON.parse(readFileSync(`client/public/fixtures/${name}.json`, "utf8")));
  return cache.get(name)!;
};

/** Playhead (ms) where a phase's beat 0 is, e.g. phaseAt("caught", "reveal", 3)
 *  = the Q4 reveal; question index omitted = first occurrence of the phase. */
function phaseAt(name: string, phase: string, questionIdx?: number): number {
  const t = tape(name);
  const f = t.frames.find((x) => x.state.phase === phase && (questionIdx === undefined || x.state.match?.questionIdx === questionIdx));
  if (!f) throw new Error(`no ${phase}${questionIdx !== undefined ? ` Q${questionIdx + 1}` : ""} in fixture ${name}`);
  return Math.round(f.state.phaseStartedAt - t.t0);
}

/** v0.26: the curve changes each tape's path, so these moments are found by
 *  what happens in them, not by question number. */
function firstWhere(name: string, what: string, ok: (s: TapeState) => boolean): TapeState {
  const f = tape(name).frames.find((x) => ok(x.state));
  if (!f) throw new Error(`no ${what} in fixture ${name}`);
  return f.state;
}
/** The first reveal that rings the last bell. */
const lastBellAt = (name: string) => {
  const s = firstWhere(name, "last-bell reveal", (x) => x.phase === "reveal" && !!x.match?.reveal?.lastBell.length);
  return Math.round(s.phaseStartedAt - tape(name).t0);
};
/** 1.5 s before the question that follows the first innocent's detention. */
const afterDetentionAt = (name: string) => {
  const vr = firstWhere(name, "wrong detention", (x) => !!x.match?.voteResult?.banishedId && !x.match.voteResult.wasCheater);
  const next = firstWhere(name, "question after the detention", (x) => x.phase === "question" && (x.match?.questionIdx ?? -1) > vr.match!.questionIdx);
  return Math.round(next.phaseStartedAt - tape(name).t0) - 1_500;
};
/** v0.27: the first reveal whose callout is an exhibit (period 1 teaches it). */
const EXHIBITS = ["lone_correct", "against_crowd", "lightning", "streak", "hard_sweep"];
const firstExhibitAt = (name: string) => {
  const s = firstWhere(name, "exhibit", (x) => x.phase === "reveal" && EXHIBITS.includes(x.match?.reveal?.callout?.kind ?? ""));
  return Math.round(s.phaseStartedAt - tape(name).t0);
};

const INSTANTS = [
  { fixture: "caught", t: phaseAt("caught", "role") + 1_000, label: "role" },
  { fixture: "caught", t: phaseAt("caught", "question", 0) + 4_000, label: "question" },
  { fixture: "caught", t: phaseAt("caught", "reveal", 3) + 3_600, label: "reveal-answer" },
  { fixture: "caught", t: phaseAt("caught", "reveal", 3) + 8_500, label: "reveal-armed" },
  // v0.23: the reveals that ring the last bell and the reveal after the
  // detention (v0.26: found by what happens, since the curve moves them).
  { fixture: "graduated", t: lastBellAt("graduated") + 8_000, label: "reveal-lastbell" },
  { fixture: "detention", t: lastBellAt("detention") + 8_000, label: "reveal-lastbell-2" },
  { fixture: "graduated", t: afterDetentionAt("graduated"), label: "reveal-after-detention" },
  { fixture: "caught", t: firstExhibitAt("caught") + 9_000, label: "reveal-teach2" }, // v0.27
  { fixture: "caught", t: phaseAt("caught", "vote") + 2_500, label: "vote" },
  { fixture: "caught", t: phaseAt("caught", "vote") + 7_000, label: "vote-open" }, // v0.23: after the floor
  { fixture: "graduated", t: phaseAt("graduated", "voteResult") + 6_000, label: "voteResult-drop" },
  { fixture: "graduated", t: phaseAt("graduated", "matchEnd") + 6_500, label: "matchEnd-graduated" },
  { fixture: "caught", t: phaseAt("caught", "matchEnd") + 7_500, label: "matchEnd-caught" },
  { fixture: "caught", t: -1500, label: "lobby" },
  { fixture: "caught", t: phaseAt("caught", "matchEnd") + 7_500, label: "matchEnd-host", host: true },
];

async function at(page: Page, fixture: string, t: number, host = false) {
  // v0.23: a hash-only goto doesn't reload, and main.ts reads the fixture
  // route once at boot: without this every instant measured the first one.
  await page.goto("about:blank");
  await page.goto(`/#/fixture/${fixture}?as=innocent&t=${t}&paused=1&ui=0${host ? "&host=1" : ""}`);
  await page.waitForFunction(() => !!window.__fixture);
  await page.waitForTimeout(1200);
}

test("reduced motion: no transform animations, same beats", async ({ browser }) => {
  const run = async (reduced: boolean) => {
    const ctx = await browser.newContext({ reducedMotion: reduced ? "reduce" : "no-preference" });
    const page = await ctx.newPage();
    await page.goto(`/#/fixture/graduated?as=innocent&t=${phaseAt("graduated", "reveal", 6) - 400}&paused=1&ui=0`);
    await page.waitForFunction(() => !!window.__fixture);
    await page.waitForTimeout(500);
    const result = await page.evaluate(async () => {
      const moving = new Set<string>();
      window.__fixture!.play();
      const t0 = performance.now();
      while (performance.now() - t0 < 9000) {
        for (const a of document.getAnimations()) {
          const e = a.effect as KeyframeEffect | null;
          if (!e?.getKeyframes) continue;
          // A 0ms transition is a discrete jump (e.g. a row repositioned while
          // faded out), not motion.
          if (Number(e.getTiming().duration) === 0) continue;
          for (const k of e.getKeyframes()) {
            for (const prop of ["transform", "translate", "scale", "rotate"]) {
              const v = (k as Record<string, unknown>)[prop];
              if (v !== undefined && v !== "none" && v !== "") {
                const t = e.target as HTMLElement | null;
                moving.add(`${(a as CSSAnimation).animationName ?? "transition"} on ${t?.className?.toString().slice(0, 40)}`);
              }
            }
          }
        }
        await new Promise((r) => setTimeout(r, 100));
      }
      // Timed beats only: an entry render with no beat yet ("reveal-…|") marks
      // when the frame happened to render, not a beat (same rule as sync.spec).
      const beats = window.__hdykt!.beats.filter((b) => b.key.startsWith("reveal-") && !b.key.endsWith("|")).map((b) => `${b.key}@${Math.round(b.server / 50) * 50}`);
      return { moving: [...moving], beats };
    });
    await ctx.close();
    return result;
  };
  const full = await run(false);
  const reduced = await run(true);
  console.log(`full motion: ${full.moving.length} moving animations; reduced: ${reduced.moving.length}`);
  expect(reduced.moving, "reduced motion must not animate transforms").toEqual([]);
  // Same beats at the same shared-clock times (50ms buckets) in both modes.
  expect(reduced.beats.map((b) => b.split("|")[1])).toEqual(full.beats.map((b) => b.split("|")[1]));
});

test("correct vs wrong is readable without colour", async ({ page, context }) => {
  await at(page, "caught", phaseAt("caught", "reveal", 3) + 4_000); // Q4 reveal, after the answer beat
  const marks = await page.evaluate(() => document.querySelector("#app")!.textContent ?? "");
  expect(marks).toContain("✓");
  expect(marks).toContain("✗");
  const cdp = await context.newCDPSession(page);
  mkdirSync("test-results/colour", { recursive: true });
  for (const type of ["achromatopsia", "deuteranopia", "protanopia", "tritanopia"] as const) {
    await cdp.send("Emulation.setEmulatedVisionDeficiency", { type });
    await page.screenshot({ path: `test-results/colour/reveal-${type}.png` });
  }
});

test("tap targets ≥44px and no horizontal overflow at 380px", async ({ page }) => {
  const problems: string[] = [];
  for (const it of INSTANTS) {
    await at(page, it.fixture, it.t, "host" in it && it.host);
    // The instant must be on screen (a stale page would measure nothing new).
    const phase = it.label.split("-")[0];
    if (!(await page.locator(`#app .screen-${phase}`).count())) problems.push(`${it.label}: not on .screen-${phase}`);
    const found = await page.evaluate(() => {
      const out: string[] = [];
      if (document.documentElement.scrollWidth > document.documentElement.clientWidth + 1) out.push(`overflowX ${document.documentElement.scrollWidth}px`);
      for (const el of document.querySelectorAll<HTMLElement>("#app button, #app [data-action], #app input, #app summary, #app select")) {
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        if (r.width === 0 || r.height === 0 || cs.visibility === "hidden" || Number(cs.opacity) === 0) continue;
        if (el.classList.contains("overlay")) continue; // full-screen backdrop
        if (r.width < 44 || r.height < 44) out.push(`${el.tagName.toLowerCase()}.${[...el.classList].join(".")} ${Math.round(r.width)}×${Math.round(r.height)}`);
      }
      return out;
    });
    for (const f of found) problems.push(`${it.label}: ${f}`);
  }
  // Home screen too.
  await page.goto("/");
  await page.waitForTimeout(800);
  const home = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("#app button, #app input")]
      .map((el) => [el, el.getBoundingClientRect()] as const)
      .filter(([, r]) => r.width > 0 && (r.width < 44 || r.height < 44))
      .map(([el, r]) => `home: ${el.tagName.toLowerCase()}.${[...el.classList].join(".")} ${Math.round(r.width)}×${Math.round(r.height)}`),
  );
  problems.push(...home);
  expect(problems, problems.join("\n")).toEqual([]);
});
