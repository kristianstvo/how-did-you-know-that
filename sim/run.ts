// Runs the simulation suites, writes per-scenario event logs (JSONL) and a
// combined report. Usage: npx tsx sim/run.ts [suite ...]   (default: all)
import { mkdirSync, writeFileSync } from "node:fs";
import { localOnlySource, resetLocalDeck } from "../client/src/providers";
import { TIER_PLAN } from "../shared/protocol";
import { analyze, type Report } from "./analyze";
import { hashSeed, mulberry32, runScenario, VirtualClock, type Accuracy, type Policy, type Scenario, type Strategy } from "./harness";

const OUT = new URL("./out/", import.meta.url);
const LOGS = new URL("./logs/", OUT);
mkdirSync(LOGS, { recursive: true });

const STRATEGIES: Strategy[] = ["naive", "mimic", "careful", "sprint"];
const MATCHES = 200;
const SEED = 20261018;

function cell(players: number, accuracy: Accuracy, strategy: Strategy, policy: Policy, mode: Scenario["mode"] = "clients", threshold?: number): Scenario {
  const base = mode === "builtinBots" ? `builtin-n${players}` : `n${players}-${accuracy}-${strategy}-${policy}`;
  const name = threshold ? `${base}-t${threshold}` : base;
  return { name, players, accuracy, strategy, policy, matches: MATCHES, seed: hashSeed(SEED, players), mode, threshold };
}

const SUITES: Record<string, () => Scenario[]> = {
  core: () => STRATEGIES.map((s) => cell(6, "mid", s, "none")),
  players: () => [4, 8].flatMap((n) => STRATEGIES.map((s) => cell(n, "mid", s, "none"))),
  accuracy: () => (["low", "high"] as Accuracy[]).flatMap((a) => STRATEGIES.map((s) => cell(6, a, s, "none"))),
  balance: () => [4, 6, 8].flatMap((n) => (["score", "scoreAware", "evidence"] as Policy[]).flatMap((p) => STRATEGIES.map((s) => cell(n, "mid", s, p)))),
  builtin: () => [4, 6, 8].map((n) => cell(n, "mid", "mimic", "score", "builtinBots")),
  threshold: () =>
    [1600, 1800, 2000].flatMap((t) => (["score", "scoreAware", "evidence"] as Policy[]).flatMap((p) => STRATEGIES.map((s) => cell(6, "mid", s, p, "clients", t)))),
};

/** The live game's offline fallback, exercised exactly as shipped: does every
 *  slot keep the tier (and therefore the points) the ramp promises? */
interface FallbackStat {
  sessions: number;
  shareOfMatchesAffected: number; // matches in which ≥1 slot has the wrong tier
  wrongSlotsPerMatch: number;
  pointsShiftPerMatch: number; // |Σ actual − Σ promised| points per match
  duplicateSubjectsPerMatch: number; // the "10 different subjects" promise
  bySessionMatch: number[]; // share affected for match #1, #2, … of a session
}

async function fallbackTierIntegrity(): Promise<Record<number, FallbackStat>> {
  const points: Record<string, number> = { easy: 100, medium: 200, hard: 400 };
  const out: Record<number, FallbackStat> = {};
  for (const sessionLen of [1, 3, 5, 8]) {
    let matches = 0;
    let affected = 0;
    let wrongSlots = 0;
    let shift = 0;
    let dupSubjects = 0;
    const byIdx = Array.from({ length: sessionLen }, () => 0);
    const sessions = 300;
    for (let s = 0; s < sessions; s++) {
      Math.random = mulberry32(hashSeed("fallback", sessionLen, s));
      resetLocalDeck();
      for (let m = 0; m < sessionLen; m++) {
        const { questions } = await localOnlySource.get();
        matches++;
        let bad = 0;
        let delta = 0;
        questions.forEach((q, i) => {
          if (q.tier !== TIER_PLAN[i]) bad++;
          delta += points[q.tier] - points[TIER_PLAN[i]];
        });
        dupSubjects += questions.length - new Set(questions.map((q) => q.subject)).size;
        if (bad) {
          affected++;
          byIdx[m]++;
        }
        wrongSlots += bad;
        shift += Math.abs(delta);
      }
    }
    out[sessionLen] = {
      sessions,
      shareOfMatchesAffected: affected / matches,
      wrongSlotsPerMatch: wrongSlots / matches,
      pointsShiftPerMatch: shift / matches,
      duplicateSubjectsPerMatch: dupSubjects / matches,
      bySessionMatch: byIdx.map((v) => v / sessions),
    };
  }
  return out;
}

const requested = process.argv.slice(2);
const suites = requested.length ? requested : Object.keys(SUITES);
const clock = new VirtualClock();
clock.install();

const reports: Record<string, { scenario: Scenario; report: Report; integrity: unknown }> = {};
const t0 = performance.now();
for (const suite of suites) {
  for (const sc of SUITES[suite]()) {
    if (reports[sc.name]) continue;
    const res = await runScenario(sc, clock);
    writeFileSync(new URL(`${sc.name}.jsonl`, LOGS), res.records.map((r) => JSON.stringify(r)).join("\n") + "\n");
    reports[sc.name] = { scenario: sc, report: analyze(res.records, sc.evidence), integrity: res.integrity };
    const r = reports[sc.name].report;
    console.log(
      `${sc.name.padEnd(28)} win ${(r.cheaterWinRate * 100).toFixed(0).padStart(3)}%  endQ ${r.endQuestion.mean.toFixed(1)}  callouts/q ${r.callouts.perQuestionSelected.toFixed(2)}  accuse/m ${r.accusations.perMatch.toFixed(2)}  integrity ${JSON.stringify(res.integrity)}`,
    );
  }
}
const fallback = await fallbackTierIntegrity();
console.log("offline-fallback tier integrity:", JSON.stringify(fallback));
writeFileSync(new URL("report.json", OUT), JSON.stringify({ reports, fallback }, null, 1));
console.log(`done in ${((performance.now() - t0) / 1000).toFixed(1)}s → sim/out/report.json`);
