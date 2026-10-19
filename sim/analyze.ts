// Event-log analyzer. Input: match event logs (simulated today, real
// playtests later — same format). Output: the metrics that decide the reveal
// design and the balance targets. Only public events are used; the cheater's
// identity comes from the matchEnd event, exactly as in a real log.
import { EvidenceTracker, DEFAULT_EVIDENCE, type CalloutKind, type EvidenceParams } from "../shared/evidence";
import type { MatchEvent } from "../shared/eventlog";
import type { Tier } from "../shared/protocol";

type Ev<T extends MatchEvent["type"]> = Extract<MatchEvent, { type: T }>;

export interface MatchLog {
  events: MatchEvent[];
}

const pct = (xs: number[], p: number) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const i = Math.min(s.length - 1, Math.max(0, Math.round((p / 100) * (s.length - 1))));
  return s[i];
};
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const rate = (num: number, den: number) => (den ? num / den : NaN);

/** Wilson 95% interval for a proportion — so small playtest samples show
 *  their uncertainty instead of a falsely precise percentage. */
export function wilson(k: number, n: number): [number, number] {
  if (!n) return [NaN, NaN];
  const z = 1.96;
  const p = k / n;
  const d = 1 + (z * z) / n;
  const c = p + (z * z) / (2 * n);
  const r = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [(c - r) / d, (c + r) / d];
}

/** P(random cheater-correct time < random innocent-correct time). 0.5 = no
 *  speed tell; 1.0 = the cheater is always faster. Mann–Whitney via ranks. */
function aucFaster(cheater: number[], innocent: number[]): number {
  if (!cheater.length || !innocent.length) return NaN;
  const all = [...cheater.map((v) => ({ v, c: 1 })), ...innocent.map((v) => ({ v, c: 0 }))].sort((a, b) => a.v - b.v);
  let rankSum = 0;
  let i = 0;
  while (i < all.length) {
    let j = i;
    while (j + 1 < all.length && all[j + 1].v === all[i].v) j++;
    const avgRank = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) if (all[k].c === 1) rankSum += avgRank;
    i = j + 1;
  }
  const n1 = cheater.length;
  const n2 = innocent.length;
  const u = rankSum - (n1 * (n1 + 1)) / 2; // pairs where cheater ranks HIGHER (slower)
  return 1 - u / (n1 * n2);
}

export interface Report {
  matches: number;
  outcomes: Record<string, number>;
  cheaterWinRate: number;
  cheaterWinCI: [number, number];
  endQuestion: { mean: number; hist: Record<number, number> };
  matchSeconds: { p50: number; p90: number };
  perTier: Record<Tier, { innocentAcc: number; cheaterAcc: number; noAnswer: number; exactlyOne: number; exactlyOneIsCheater: number; allMiss: number; allCorrect: number; reveals: number }>;
  times: Record<string, { p10: number; p50: number; p90: number; n: number }>;
  speedTellAUC: { all: number; mediumHard: number };
  streaks: { cheaterLongestMean: number; innocentLongestMean: number; cheaterGe4: number; innocentGe4: number };
  proximity: { crossQuestion: Record<number, number>; innocentEverWithin400: number; innocentEndsAtOrAboveLine: number; cheaterFinalGapP50: number };
  callouts: {
    perQuestionSelected: number;
    perQuestionAny: number;
    byKind: Record<string, { candidatePerQ: number; selectedPerQ: number; precision: number; chance: number; lift: number; n: number }>;
    byTierSelected: Record<Tier, number>;
  };
  accusations: {
    perMatch: number;
    firstAccuseQuestion: { p50: number; mean: number; none: number };
    firstAccuseSeconds: { p50: number };
    banishCheater: number;
    banishInnocent: number;
    banishedProvablyInnocent: number; // banished someone already at/above the line
    tie: number;
    total: number;
  };
}

export function analyze(logs: MatchLog[], evidence: EvidenceParams = DEFAULT_EVIDENCE): Report {
  const outcomes: Record<string, number> = {};
  let cheaterWins = 0;
  const endQs: number[] = [];
  const endHist: Record<number, number> = {};
  const matchSecs: number[] = [];
  const tiers: Tier[] = ["easy", "medium", "hard"];
  const tierAgg = Object.fromEntries(tiers.map((t) => [t, { innoC: 0, innoN: 0, chC: 0, chN: 0, noAns: 0, rows: 0, one: 0, oneCheater: 0, allMiss: 0, allCorrect: 0, reveals: 0, eligible: 0 }])) as unknown as Record<Tier, Record<string, number>>;
  const times: Record<string, number[]> = { cheater_correct: [], cheater_wrong: [], innocent_correct: [], innocent_wrong: [] };
  const timesMH: Record<string, number[]> = { cheater_correct: [], innocent_correct: [] };
  const chStreaks: number[] = [];
  const inStreaks: number[] = [];
  const crossQ: Record<number, number> = {};
  let innoWithin = 0;
  let innoAbove = 0;
  const cheaterGaps: number[] = [];
  let questionsSeen = 0;
  let selectedTotal = 0;
  let anyTotal = 0;
  const kindAgg: Record<string, { cand: number; sel: number; hit: number; chance: number }> = {};
  const tierSel: Record<Tier, { sel: number; n: number }> = { easy: { sel: 0, n: 0 }, medium: { sel: 0, n: 0 }, hard: { sel: 0, n: 0 } };
  let accusations = 0;
  const firstQ: number[] = [];
  const firstSec: number[] = [];
  let noAccuse = 0;
  let banC = 0;
  let banI = 0;
  let tie = 0;
  let banishedCleared = 0;

  for (const log of logs) {
    const start = log.events.find((e): e is Ev<"matchStart"> => e.type === "matchStart");
    const end = log.events.find((e): e is Ev<"matchEnd"> => e.type === "matchEnd");
    if (!start || !end) continue;
    const cheater = end.cheaterId;
    outcomes[end.reason] = (outcomes[end.reason] ?? 0) + 1;
    if (end.reason === "cheater_threshold" || (end.reason === "top_score" && end.winnerIds.includes(cheater))) cheaterWins++;
    if (end.reason === "top_score") {
      const key = end.winnerIds.includes(cheater) ? "top_score_cheater" : "top_score_innocent";
      outcomes[key] = (outcomes[key] ?? 0) + 1;
    }
    endQs.push(end.q + 1);
    endHist[end.q + 1] = (endHist[end.q + 1] ?? 0) + 1;
    matchSecs.push((end.t - start.t) / 1000);

    const reveals = log.events.filter((e): e is Ev<"reveal"> => e.type === "reveal");
    const streak: Record<string, number> = {};
    const longest: Record<string, number> = {};
    const tracker = new EvidenceTracker(evidence);
    let everWithin = false;
    // Seats that weren't connected at match start stay in the engine's rows as
    // permanent no-answers; they are not players for these statistics.
    const present = new Set(start.players.map((p) => p.id));
    for (const r of reveals) {
      questionsSeen++;
      const ta = tierAgg[r.tier];
      ta.reveals++;
      const rows = r.rows.filter((row) => present.has(row.playerId));
      const answered = rows.filter((row) => row.pick !== -1);
      const correct = rows.filter((row) => row.correct);
      for (const row of rows) {
        const isCh = row.playerId === cheater;
        ta.rows++;
        if (row.pick === -1) ta.noAns++;
        if (isCh) {
          ta.chN++;
          if (row.correct) ta.chC++;
        } else {
          ta.innoN++;
          if (row.correct) ta.innoC++;
        }
        if (row.pick !== -1) {
          const key = `${isCh ? "cheater" : "innocent"}_${row.correct ? "correct" : "wrong"}`;
          times[key].push(row.timeMs);
          if (r.tier !== "easy" && row.correct) timesMH[isCh ? "cheater_correct" : "innocent_correct"].push(row.timeMs);
        }
        streak[row.playerId] = row.correct ? (streak[row.playerId] ?? 0) + 1 : 0;
        longest[row.playerId] = Math.max(longest[row.playerId] ?? 0, streak[row.playerId]);
      }
      if (answered.length >= 3) {
        ta.eligible++;
        if (correct.length === 1) {
          ta.one++;
          if (correct[0].playerId === cheater) ta.oneCheater++;
        }
        if (correct.length === 0) ta.allMiss++;
        if (correct.length === answered.length) ta.allCorrect++;
      }
      const innoMax = Math.max(...Object.entries(r.scores).filter(([id]) => id !== cheater).map(([, s]) => s));
      if (r.threshold - innoMax <= 400) everWithin = true;

      if (r.final) continue; // the winning answer: shown on the end screen, not as a reveal
      const active = Object.keys(r.scores).filter((id) => !r.banished.includes(id));
      const computed = tracker.add({ questionIdx: r.q, tier: r.tier, rows: r.rows, scores: r.scores, threshold: r.threshold, activeIds: active });
      // Real playtest logs record what the room was actually shown; trust that
      // over the recomputation (the engine also clears players right after a
      // line drop, which a pure replay of reveals can't see).
      const res =
        r.callout !== undefined
          ? { ...computed, selected: r.callout ? { kind: r.callout.kind as CalloutKind, subjectIds: r.callout.subjectIds, priority: 0, detail: {} } : null }
          : computed;
      for (const id of r.cleared ?? []) tracker.cleared.add(id);
      if (res.candidates.length) anyTotal++;
      tierSel[r.tier].n++;
      const seenKinds = new Set<CalloutKind>();
      for (const c of res.candidates) {
        if (seenKinds.has(c.kind)) continue;
        seenKinds.add(c.kind);
        (kindAgg[c.kind] ??= { cand: 0, sel: 0, hit: 0, chance: 0 }).cand++;
      }
      if (res.selected) {
        selectedTotal++;
        tierSel[r.tier].sel++;
        const k = (kindAgg[res.selected.kind] ??= { cand: 0, sel: 0, hit: 0, chance: 0 });
        k.sel++;
        if (res.selected.subjectIds.length) {
          if (res.selected.subjectIds.includes(cheater)) k.hit++;
          k.chance += res.selected.subjectIds.length / active.length;
        }
      }
    }
    chStreaks.push(longest[cheater] ?? 0);
    inStreaks.push(Math.max(0, ...Object.entries(longest).filter(([id]) => id !== cheater).map(([, v]) => v)));
    if (everWithin) innoWithin++;
    const innoFinal = Math.max(...Object.entries(end.scores).filter(([id]) => id !== cheater).map(([, s]) => s));
    if (innoFinal >= end.threshold) innoAbove++;
    if (end.reason === "cheater_threshold") crossQ[end.q + 1] = (crossQ[end.q + 1] ?? 0) + 1;
    else cheaterGaps.push(end.threshold - end.scores[cheater]);

    const accuses = log.events.filter((e): e is Ev<"accuse"> => e.type === "accuse");
    accusations += accuses.length;
    if (accuses.length) {
      firstQ.push(accuses[0].q + 1);
      firstSec.push((accuses[0].t - start.t) / 1000);
    } else noAccuse++;
    // Walk events in order so we know who was provably cleared at vote time.
    const clearedSoFar = new Set<string>();
    for (const e of log.events) {
      if (e.type === "reveal") {
        for (const [id, s] of Object.entries(e.scores)) if (s >= e.threshold && !e.banished.includes(id)) clearedSoFar.add(id);
      } else if (e.type === "voteResult") {
        if (e.tie) tie++;
        else if (e.wasCheater) banC++;
        else {
          banI++;
          if (e.banishedId && clearedSoFar.has(e.banishedId)) banishedCleared++;
        }
      }
    }
  }

  const n = endQs.length;
  const fmtTimes = (xs: number[]) => ({ p10: pct(xs, 10), p50: pct(xs, 50), p90: pct(xs, 90), n: xs.length });
  return {
    matches: n,
    outcomes,
    cheaterWinRate: rate(cheaterWins, n),
    cheaterWinCI: wilson(cheaterWins, n),
    endQuestion: { mean: mean(endQs), hist: endHist },
    matchSeconds: { p50: pct(matchSecs, 50), p90: pct(matchSecs, 90) },
    perTier: Object.fromEntries(
      tiers.map((t) => {
        const a = tierAgg[t];
        // innocentAcc counts no-answers as wrong (share of all innocent rows).
        // exactlyOne / allMiss / allCorrect are conditional on ≥3 answerers.
        return [t, { innocentAcc: rate(a.innoC, a.innoN), cheaterAcc: rate(a.chC, a.chN), noAnswer: rate(a.noAns, a.rows), exactlyOne: rate(a.one, a.eligible), exactlyOneIsCheater: rate(a.oneCheater, a.one), allMiss: rate(a.allMiss, a.eligible), allCorrect: rate(a.allCorrect, a.eligible), reveals: a.reveals }];
      }),
    ) as Report["perTier"],
    times: Object.fromEntries(Object.entries(times).map(([k, v]) => [k, fmtTimes(v)])),
    speedTellAUC: { all: aucFaster(times.cheater_correct, times.innocent_correct), mediumHard: aucFaster(timesMH.cheater_correct, timesMH.innocent_correct) },
    streaks: {
      cheaterLongestMean: mean(chStreaks),
      innocentLongestMean: mean(inStreaks),
      cheaterGe4: rate(chStreaks.filter((s) => s >= 4).length, n),
      innocentGe4: rate(inStreaks.filter((s) => s >= 4).length, n),
    },
    proximity: { crossQuestion: crossQ, innocentEverWithin400: rate(innoWithin, n), innocentEndsAtOrAboveLine: rate(innoAbove, n), cheaterFinalGapP50: pct(cheaterGaps, 50) },
    callouts: {
      perQuestionSelected: rate(selectedTotal, questionsSeen),
      perQuestionAny: rate(anyTotal, questionsSeen),
      byKind: Object.fromEntries(
        Object.entries(kindAgg).map(([k, a]) => {
          const precision = rate(a.hit, a.sel);
          const chance = rate(a.chance, a.sel);
          return [k, { candidatePerQ: rate(a.cand, questionsSeen), selectedPerQ: rate(a.sel, questionsSeen), precision, chance, lift: precision / chance, n: a.sel }];
        }),
      ),
      byTierSelected: Object.fromEntries(tiers.map((t) => [t, rate(tierSel[t].sel, tierSel[t].n)])) as Record<Tier, number>,
    },
    accusations: {
      perMatch: rate(accusations, n),
      firstAccuseQuestion: { p50: pct(firstQ, 50), mean: mean(firstQ), none: rate(noAccuse, n) },
      firstAccuseSeconds: { p50: pct(firstSec, 50) },
      banishCheater: banC,
      banishInnocent: banI,
      banishedProvablyInnocent: banishedCleared,
      tie,
      total: banC + banI + tie,
    },
  };
}
