// PERFORMANCE: ≥55fps during the reveal with the CPU throttled 4× and 6×.
// Plays recorded high-stakes reveals (plus a vote takeover and a match-end
// show) in real time and samples requestAnimationFrame intervals and Long
// Animation Frames. Headless rAF can run faster than 60Hz, so "55fps" is
// judged as frame budget: p95 frame interval ≤ 18.2ms (= 55fps) and ≤ 5% of
// frames over 18.2ms. Caveat (design/research-motion-and-tech.md §5): CDP CPU
// throttling doesn't slow the GPU, so this is a necessary, not sufficient,
// proof — also check a real mid-range Android.
import { expect, test } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

// Moments derived from the recorded fixtures (never hard-coded times).
interface Tape {
  t0: number;
  frames: { t: number; state: { phase: string; phaseStartedAt: number; match: { questionIdx: number } | null } }[];
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

const SCENES = [
  { fixture: "caught", start: phaseAt("caught", "reveal", 3), ms: 8_000, label: "reveal Q4 high + lone_correct" },
  { fixture: "graduated", start: phaseAt("graduated", "reveal", 6), ms: 8_000, label: "reveal Q7 high + near_line + LAST BELL" },
  { fixture: "detention", start: phaseAt("detention", "reveal", 2), ms: 8_000, label: "reveal Q3 high + against_crowd" },
  { fixture: "caught", start: phaseAt("caught", "vote"), ms: 4_000, label: "vote takeover" },
  { fixture: "graduated", start: phaseAt("graduated", "voteResult"), ms: 7_000, label: "vote result + line drop" },
  { fixture: "graduated", start: phaseAt("graduated", "matchEnd"), ms: 6_500, label: "match end: graduated" },
];

const results: Record<string, unknown>[] = [];

for (const rate of [4, 6]) {
  for (const sc of SCENES) {
    test(`perf ${rate}x CPU: ${sc.label}`, async ({ page, context }) => {
      const cdp = await context.newCDPSession(page);
      await cdp.send("Emulation.setCPUThrottlingRate", { rate });
      // Start just before the scene, paused, so loading cost isn't measured.
      await page.goto(`/#/fixture/${sc.fixture}?as=innocent&t=${sc.start - 400}&paused=1&ui=0`);
      await page.waitForFunction(() => !!window.__fixture);
      await page.waitForTimeout(800);
      const stats = await page.evaluate(async (ms) => {
        const intervals: number[] = [];
        let loaf = 0;
        let loafWorst = 0;
        try {
          new PerformanceObserver((list) => {
            for (const e of list.getEntries()) {
              loaf++;
              loafWorst = Math.max(loafWorst, e.duration);
            }
          }).observe({ type: "long-animation-frame", buffered: false });
        } catch {
          /* LoAF unsupported */
        }
        window.__fixture!.play();
        let last = performance.now();
        const t0 = last;
        await new Promise<void>((resolve) => {
          const f = (now: number) => {
            intervals.push(now - last);
            last = now;
            if (now - t0 < ms) requestAnimationFrame(f);
            else resolve();
          };
          requestAnimationFrame(f);
        });
        intervals.shift();
        const sorted = [...intervals].sort((a, b) => a - b);
        const p95 = sorted[Math.floor(sorted.length * 0.95)];
        const over = intervals.filter((x) => x > 18.2).length / intervals.length;
        const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length;
        return { frames: intervals.length, meanFps: 1000 / mean, p95, max: sorted[sorted.length - 1], over18: over, loaf, loafWorst };
      }, sc.ms);
      const row = { rate, scene: sc.label, ...stats };
      results.push(row);
      console.log(JSON.stringify(row));
      mkdirSync("test-results", { recursive: true });
      writeFileSync("test-results/perf.json", JSON.stringify(results, null, 1));
      expect(stats.p95, "p95 frame interval within the 55fps budget").toBeLessThanOrEqual(18.2);
      expect(stats.over18, "share of frames over the 55fps budget").toBeLessThanOrEqual(0.05);
    });
  }
}
