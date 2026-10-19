// Renders sim/out/report.json (+ tune.json) into sim/out/FINDINGS-DATA.md:
// the tables the beat sheet and the sign-off doc cite. Regenerate with
// `npx tsx sim/run.ts && npx tsx sim/tune.ts && npx tsx sim/report.ts`.
import { readFileSync, writeFileSync } from "node:fs";
import type { Report } from "./analyze";

const OUT = new URL("./out/", import.meta.url);
const { reports, fallback } = JSON.parse(readFileSync(new URL("report.json", OUT), "utf8")) as {
  reports: Record<string, { report: Report; integrity: { cheaterSecretMismatches: number; innocentSecretLeaks: number } }>;
  fallback: Record<string, { shareOfMatchesAffected: number; wrongSlotsPerMatch: number; pointsShiftPerMatch: number; duplicateSubjectsPerMatch: number; bySessionMatch: number[] }>;
};
let tune: { baseline: unknown; best: unknown } | null = null;
try {
  tune = JSON.parse(readFileSync(new URL("tune.json", OUT), "utf8"));
} catch {
  tune = null;
}

const P = (x: number, d = 0) => (Number.isFinite(x) ? `${(x * 100).toFixed(d)}%` : "—");
const N = (x: number, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : "—");
const S = (ms: number) => (Number.isFinite(ms) ? `${(ms / 1000).toFixed(1)}s` : "—");
const get = (k: string) => reports[k]?.report;
const STRATS = ["naive", "mimic", "careful", "sprint"];
const lines: string[] = [];
const out = (s = "") => lines.push(s);
const table = (head: string[], rows: (string | number)[][]) => {
  out(`| ${head.join(" | ")} |`);
  out(`| ${head.map(() => "---").join(" | ")} |`);
  for (const r of rows) out(`| ${r.join(" | ")} |`);
  out();
};

const totalMatches = Object.values(reports).reduce((a, r) => a + r.report.matches, 0);
const integrity = Object.values(reports).reduce(
  (a, r) => ({ m: a.m + r.integrity.cheaterSecretMismatches, l: a.l + r.integrity.innocentSecretLeaks }),
  { m: 0, l: 0 },
);
out(`# Simulation data (generated)`);
out();
out(`${Object.keys(reports).length} scenarios, ${totalMatches} matches. Protocol integrity: cheater secret mismatches ${integrity.m}, innocent secret leaks ${integrity.l}.`);
out();

out(`## A. Reference room — 6 players, mid accuracy, nobody accuses (200 matches per strategy)`);
out();
table(
  ["metric", ...STRATS],
  [
    ["innocent accuracy easy / med / hard", ...STRATS.map((s) => { const r = get(`n6-mid-${s}-none`); return `${P(r.perTier.easy.innocentAcc)} / ${P(r.perTier.medium.innocentAcc)} / ${P(r.perTier.hard.innocentAcc)}`; })],
    ["cheater accuracy easy / med / hard", ...STRATS.map((s) => { const r = get(`n6-mid-${s}-none`); return `${P(r.perTier.easy.cheaterAcc)} / ${P(r.perTier.medium.cheaterAcc)} / ${P(r.perTier.hard.cheaterAcc)}`; })],
    ["exactly one correct (med / hard)", ...STRATS.map((s) => { const r = get(`n6-mid-${s}-none`); return `${P(r.perTier.medium.exactlyOne, 1)} / ${P(r.perTier.hard.exactlyOne, 1)}`; })],
    ["…and that one is the cheater (med / hard)", ...STRATS.map((s) => { const r = get(`n6-mid-${s}-none`); return `${P(r.perTier.medium.exactlyOneIsCheater)} / ${P(r.perTier.hard.exactlyOneIsCheater)}`; })],
    ["everyone misses (easy / med / hard)", ...STRATS.map((s) => { const r = get(`n6-mid-${s}-none`); return `${P(r.perTier.easy.allMiss, 1)} / ${P(r.perTier.medium.allMiss, 1)} / ${P(r.perTier.hard.allMiss, 1)}`; })],
    ["everyone correct (easy / med / hard)", ...STRATS.map((s) => { const r = get(`n6-mid-${s}-none`); return `${P(r.perTier.easy.allCorrect)} / ${P(r.perTier.medium.allCorrect)} / ${P(r.perTier.hard.allCorrect)}`; })],
    ["no-answer rate (hard)", ...STRATS.map((s) => P(get(`n6-mid-${s}-none`).perTier.hard.noAnswer, 1))],
    ["cheater correct time p10/p50/p90", ...STRATS.map((s) => { const t = get(`n6-mid-${s}-none`).times.cheater_correct; return `${S(t.p10)} / ${S(t.p50)} / ${S(t.p90)}`; })],
    ["innocent correct time p10/p50/p90", ...STRATS.map((s) => { const t = get(`n6-mid-${s}-none`).times.innocent_correct; return `${S(t.p10)} / ${S(t.p50)} / ${S(t.p90)}`; })],
    ["innocent wrong time p50", ...STRATS.map((s) => S(get(`n6-mid-${s}-none`).times.innocent_wrong.p50))],
    ["speed tell AUC (med+hard; 0.5 = none)", ...STRATS.map((s) => N(get(`n6-mid-${s}-none`).speedTellAUC.mediumHard, 2))],
    ["longest streak: cheater / best innocent", ...STRATS.map((s) => { const r = get(`n6-mid-${s}-none`); return `${N(r.streaks.cheaterLongestMean)} / ${N(r.streaks.innocentLongestMean)}`; })],
    ["some innocent reaches a 4-streak", ...STRATS.map((s) => P(get(`n6-mid-${s}-none`).streaks.innocentGe4))],
    ["cheater crosses the line at Q (count)", ...STRATS.map((s) => Object.entries(get(`n6-mid-${s}-none`).proximity.crossQuestion).map(([q, c]) => `Q${q}:${c}`).join(" "))],
    ["an innocent gets within 400 of the line", ...STRATS.map((s) => P(get(`n6-mid-${s}-none`).proximity.innocentEverWithin400))],
    ["an innocent ends at/above the line", ...STRATS.map((s) => P(get(`n6-mid-${s}-none`).proximity.innocentEndsAtOrAboveLine))],
    ["match length p50 (s)", ...STRATS.map((s) => N(get(`n6-mid-${s}-none`).matchSeconds.p50, 0))],
  ],
);

out(`## B. Callouts per kind — reference room (selected = announced)`);
out();
for (const s of STRATS) {
  const r = get(`n6-mid-${s}-none`);
  out(`**${s}** — ${N(r.callouts.perQuestionSelected, 2)} announced per question (easy ${P(r.callouts.byTierSelected.easy)}, medium ${P(r.callouts.byTierSelected.medium)}, hard ${P(r.callouts.byTierSelected.hard)} of reveals)`);
  out();
  table(
    ["kind", "fires (cand/q)", "announced/q", "points at cheater", "chance", "lift"],
    Object.entries(r.callouts.byKind)
      .sort((a, b) => b[1].selectedPerQ - a[1].selectedPerQ)
      .map(([k, v]) => [k, N(v.candidatePerQ, 3), N(v.selectedPerQ, 3), P(v.precision), P(v.chance), N(v.lift, 2)]),
  );
}

out(`## C. Player count & accuracy sensitivity (nobody accuses) — callouts announced per question / speed AUC`);
out();
const sens: (string | number)[][] = [];
for (const k of ["n4-mid", "n6-mid", "n8-mid", "n6-low", "n6-high"]) {
  sens.push([k, ...STRATS.map((s) => { const r = get(`${k}-${s}-none`); return r ? `${N(r.callouts.perQuestionSelected, 2)} / ${N(r.speedTellAUC.mediumHard, 2)} / hard 1-correct ${P(r.perTier.hard.exactlyOne)}` : "—"; })]);
}
table(["room", ...STRATS], sens);

out(`## D. Balance — cheater win rate (95% CI) by room behaviour`);
out();
const bal: (string | number)[][] = [];
for (const n of [4, 6, 8]) {
  for (const p of ["score", "scoreAware", "evidence"]) {
    bal.push([`${n} players · ${p}`, ...STRATS.map((s) => { const r = get(`n${n}-mid-${s}-${p}`); return r ? `${P(r.cheaterWinRate)} (${P(r.cheaterWinCI[0])}–${P(r.cheaterWinCI[1])})` : "—"; })]);
  }
}
for (const t of [1600, 1800, 2000]) {
  for (const p of ["score", "scoreAware", "evidence"]) {
    bal.push([`6 players · ${p} · line ${t}`, ...STRATS.map((s) => { const r = get(`n6-mid-${s}-${p}-t${t}`); return r ? `${P(r.cheaterWinRate)} (${P(r.cheaterWinCI[0])}–${P(r.cheaterWinCI[1])})` : "—"; })]);
  }
}
table(["room", ...STRATS], bal);

out(`## E. Accusation behaviour (6 players, mid)`);
out();
const acc: (string | number)[][] = [];
for (const p of ["score", "scoreAware", "evidence"]) {
  for (const s of STRATS) {
    const r = get(`n6-mid-${s}-${p}`);
    if (!r) continue;
    const a = r.accusations;
    acc.push([`${p} · ${s}`, N(a.perMatch, 2), `Q${N(a.firstAccuseQuestion.p50, 0)}`, P(a.firstAccuseQuestion.none), `${a.banishCheater}/${a.banishInnocent}/${a.tie}`, a.banishedProvablyInnocent]);
  }
}
table(["room · cheater", "accusations / match", "first accusation (median Q)", "matches with none", "banished cheater / innocent / tie", "banished a CLEARED player"], acc);

out(`## F. Shipped bots (engine's built-in bot behaviour, host plays mimic-style)`);
out();
table(
  ["players", "cheater win", "accusations / match", "first accusation (median Q)", "end Q (mean)"],
  [4, 6, 8].map((n) => { const r = get(`builtin-n${n}`); return [n, P(r.cheaterWinRate), N(r.accusations.perMatch, 2), `Q${N(r.accusations.firstAccuseQuestion.p50, 0)}`, N(r.endQuestion.mean, 1)]; }),
);

out(`## G. Offline fallback — does every slot keep its tier? (after fix)`);
out();
table(
  ["matches per session", "matches with a wrong-tier slot", "wrong slots / match", "points shift / match", "duplicate subjects / match", "by match # in session"],
  Object.entries(fallback).map(([k, v]) => [k, P(v.shareOfMatchesAffected), N(v.wrongSlotsPerMatch, 2), N(v.pointsShiftPerMatch, 0), N(v.duplicateSubjectsPerMatch, 2), v.bySessionMatch.map((x) => P(x)).join(" ")]),
);

if (tune) {
  out(`## H. Callout tuning (see sim/out/tune.json)`);
  out();
  out("```json");
  out(JSON.stringify({ baseline: tune.baseline, best: tune.best }, (_, v) => (typeof v === "number" ? +v.toFixed(3) : v), 1));
  out("```");
}

writeFileSync(new URL("FINDINGS-DATA.md", OUT), lines.join("\n"));
console.log(`wrote sim/out/FINDINGS-DATA.md (${lines.length} lines)`);
