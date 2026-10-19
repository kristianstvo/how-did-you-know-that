// Callout tuning: replay logged reveals through EvidenceTracker under a grid
// of parameters. Goals: (1) announce ~1 callout per 2 questions, (2) stay
// informative against the HARDEST cheater strategy (max of the minimum lift
// across strategies), (3) don't solve a disciplined cheater too early.
// The winner is chosen by bootstrap stability (how often a setting is best
// when matches are resampled), not by a single noisy argmax.
// Usage: npx tsx sim/tune.ts   (reads sim/out/logs/*-none.jsonl)
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { DEFAULT_EVIDENCE, EvidenceTracker, type EvidenceParams } from "../shared/evidence";
import type { MatchEvent } from "../shared/eventlog";
import { mulberry32 } from "./harness";

type Ev<T extends MatchEvent["type"]> = Extract<MatchEvent, { type: T }>;
const LOGS = new URL("./out/logs/", import.meta.url);
const files = readdirSync(LOGS).filter((f) => /^n\d-(mid|low|high)-\w+-none\.jsonl$/.test(f));
const matches: { strategy: string; events: MatchEvent[] }[] = [];
for (const f of files) {
  const strategy = f.split("-")[2];
  for (const line of readFileSync(new URL(f, LOGS), "utf8").split("\n")) {
    if (line.trim()) matches.push({ strategy, events: JSON.parse(line).events });
  }
}
const STRATS = [...new Set(matches.map((m) => m.strategy))];

const POINTING = new Set(["lone_correct", "against_crowd", "lightning", "streak", "hard_sweep", "near_line"]);
const WEIGHT: Record<string, number> = { lone_correct: 2, against_crowd: 1.5, lightning: 1.5, streak: 1, hard_sweep: 2, near_line: 1 };

/** Per-match tallies for one parameter set — summable, so bootstrap is cheap. */
interface MatchTally {
  q: number;
  sel: number;
  hit: number;
  chance: number;
  solvedEarly: number;
  mhQ: number;
  mhQuiet: number;
  tierQ: Record<string, number>;
  tierSel: Record<string, number>;
}

function tallies(params: EvidenceParams): MatchTally[] {
  return matches.map(({ events }) => {
    const end = events.find((e): e is Ev<"matchEnd"> => e.type === "matchEnd")!;
    const cheater = end.cheaterId;
    const t = new EvidenceTracker(params);
    const weight: Record<string, number> = {};
    const out: MatchTally = { q: 0, sel: 0, hit: 0, chance: 0, solvedEarly: 0, mhQ: 0, mhQuiet: 0, tierQ: {}, tierSel: {} };
    for (const e of events) {
      if (e.type !== "reveal" || e.final) continue;
      out.q++;
      out.tierQ[e.tier] = (out.tierQ[e.tier] ?? 0) + 1;
      const active = Object.keys(e.scores).filter((id) => !e.banished.includes(id));
      const res = t.add({ questionIdx: e.q, tier: e.tier, rows: e.rows, scores: e.scores, threshold: e.threshold, activeIds: active });
      if (e.tier !== "easy") {
        out.mhQ++;
        if (!res.selected) out.mhQuiet++;
      }
      if (!res.selected) continue;
      out.sel++;
      out.tierSel[e.tier] = (out.tierSel[e.tier] ?? 0) + 1;
      if (POINTING.has(res.selected.kind)) {
        const suspects = active.filter((id) => !t.cleared.has(id));
        if (res.selected.subjectIds.includes(cheater)) out.hit++;
        out.chance += res.selected.subjectIds.length / Math.max(1, suspects.length);
        for (const id of res.selected.subjectIds) weight[id] = (weight[id] ?? 0) + WEIGHT[res.selected.kind];
      }
      if (e.q <= 5 && !out.solvedEarly) {
        const ranked = Object.entries(weight).sort((a, b) => b[1] - a[1]);
        if (ranked.length && ranked[0][0] === cheater && ranked[0][1] - (ranked[1]?.[1] ?? 0) >= 2) out.solvedEarly = 1;
      }
    }
    return out;
  });
}

interface Summary {
  ratePerQ: number;
  rateByTier: Record<string, number>;
  quietMediumHard: number;
  liftByStrategy: Record<string, number>;
  minLift: number;
  earlySolveByStrategy: Record<string, number>;
}

function summarize(t: MatchTally[], idx: number[]): Summary {
  let q = 0, sel = 0, mhQ = 0, mhQuiet = 0;
  const tierQ: Record<string, number> = {};
  const tierSel: Record<string, number> = {};
  const byS: Record<string, { hit: number; chance: number; solved: number; n: number }> = {};
  for (const i of idx) {
    const m = t[i];
    q += m.q;
    sel += m.sel;
    mhQ += m.mhQ;
    mhQuiet += m.mhQuiet;
    for (const [k, v] of Object.entries(m.tierQ)) tierQ[k] = (tierQ[k] ?? 0) + v;
    for (const [k, v] of Object.entries(m.tierSel)) tierSel[k] = (tierSel[k] ?? 0) + v;
    const s = (byS[matches[i].strategy] ??= { hit: 0, chance: 0, solved: 0, n: 0 });
    s.hit += m.hit;
    s.chance += m.chance;
    s.solved += m.solvedEarly;
    s.n++;
  }
  const liftByStrategy = Object.fromEntries(STRATS.map((s) => [s, byS[s]?.chance ? byS[s].hit / byS[s].chance : NaN]));
  return {
    ratePerQ: sel / q,
    rateByTier: Object.fromEntries(Object.keys(tierQ).map((k) => [k, (tierSel[k] ?? 0) / tierQ[k]])),
    quietMediumHard: mhQuiet / mhQ,
    liftByStrategy,
    minLift: Math.min(...Object.values(liftByStrategy).filter((v) => !Number.isNaN(v))),
    earlySolveByStrategy: Object.fromEntries(STRATS.map((s) => [s, byS[s] ? byS[s].solved / byS[s].n : NaN])),
  };
}

const grid: EvidenceParams[] = [];
for (const streakLen of [4, 5, 6])
  for (const lightningMaxMs of [2500, 3000, 4000])
    for (const lightningRatio of [0.4, 0.5, 0.6])
      for (const nearLineGap of [300, 400])
        for (const crowdMinShare of [0.5, 0.6])
          grid.push({ ...DEFAULT_EVIDENCE, streakLen, lightningMaxMs, lightningRatio, nearLineGap, crowdMinShare });

const all = matches.map((_, i) => i);
const perParam = grid.map((params) => ({ params, t: tallies(params) }));
const full = perParam.map((p) => ({ params: p.params, s: summarize(p.t, all) }));
const BAND: [number, number] = [0.45, 0.55];
const inBand = (s: Summary) => s.ratePerQ >= BAND[0] && s.ratePerQ <= BAND[1];

// Bootstrap: resample matches, find the in-band setting with the best minLift
// (ties → lower careful early-solve). Count wins per setting.
const B = 200;
const wins = new Array(grid.length).fill(0);
const rng = mulberry32(42);
for (let b = 0; b < B; b++) {
  const idx = all.map(() => Math.floor(rng() * all.length));
  let best = -1;
  let bestS: Summary | null = null;
  perParam.forEach((p, i) => {
    const s = summarize(p.t, idx);
    if (!inBand(s)) return;
    if (!bestS || s.minLift > bestS.minLift || (s.minLift === bestS.minLift && s.earlySolveByStrategy.careful < bestS.earlySolveByStrategy.careful)) {
      best = i;
      bestS = s;
    }
  });
  if (best >= 0) wins[best]++;
}

const ranked = full
  .map((f, i) => ({ ...f, bootstrapWins: wins[i] / B }))
  .filter((f) => inBand(f.s))
  .sort((a, b) => b.bootstrapWins - a.bootstrapWins || b.s.minLift - a.s.minLift);
const baseline = summarize(tallies(DEFAULT_EVIDENCE), all);
const r2 = (v: unknown) => JSON.stringify(v, (_, x) => (typeof x === "number" ? +x.toFixed(3) : x));
const label = (p: EvidenceParams) => `streak ${p.streakLen} lightning ${p.lightningMaxMs}/${p.lightningRatio} near ${p.nearLineGap} crowd ${p.crowdMinShare}`;
console.log("matches by strategy:", Object.fromEntries(STRATS.map((s) => [s, matches.filter((m) => m.strategy === s).length])));
console.log("BASELINE", label(DEFAULT_EVIDENCE), r2(baseline));
console.log(`in band ${ranked.length}/${grid.length}; most stable under ${B} bootstrap resamples:`);
for (const r of ranked.slice(0, 6)) console.log(`  wins ${(r.bootstrapWins * 100).toFixed(0)}% | ${label(r.params)} | ${r2(r.s)}`);
writeFileSync(
  new URL("./out/tune.json", import.meta.url),
  JSON.stringify({ baseline: { params: DEFAULT_EVIDENCE, ...baseline }, best: ranked[0] && { params: ranked[0].params, bootstrapWins: ranked[0].bootstrapWins, ...ranked[0].s }, ranked: ranked.slice(0, 20).map((r) => ({ params: r.params, bootstrapWins: r.bootstrapWins, ...r.s })) }, null, 1),
);
