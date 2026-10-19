// Evidence callouts: what the reveal says out loud about the room.
// Pure functions over PUBLIC reveal data only — nothing here may depend on
// who the cheater is. Shared by the simulator, the event-log analyzer and
// (after sign-off) the live reveal UI, so tuned numbers are shipped numbers.
import type { RevealRow, Tier } from "./protocol";

export type CalloutKind =
  | "lone_correct" // only one player got a medium/hard question right
  | "against_crowd" // most of the room fell for the same wrong option; ≤2 didn't
  | "lightning" // fastest correct answer far quicker than the room
  | "streak" // someone just reached N correct in a row
  | "hard_sweep" // someone is perfect on every hard question so far
  | "near_line" // top score is within one hard question of graduating
  | "stumper" // nobody got it — not even the cheater
  | "silent" // someone didn't answer at all
  | "cleared"; // crossed the line and no siren: provably not the cheater

export interface Callout {
  kind: CalloutKind;
  subjectIds: string[]; // who it points at (empty for stumper)
  priority: number; // higher wins when several fire on one reveal
  detail: Record<string, number>; // numbers the UI can show (ms, streak length…)
}

export interface EvidenceParams {
  loneMinTier: Tier;
  minAnswerers: number; // ignore reveals where too few people answered
  lightningMaxMs: number; // fastest correct must be under this…
  lightningRatio: number; // …and under this fraction of the room's median time
  lightningMinTier: Tier;
  streakLen: number; // fire when a streak reaches this, then every +2
  hardSweepMin: number; // hard questions answered before a sweep counts
  nearLineGap: number; // points from the line that count as "near"
  crowdMinShare: number; // share of answerers on one wrong option
  silentEnabled: boolean;
}

// Tuned by sim/tune.ts (most stable setting under 200 bootstrap resamples of
// 4,000 simulated matches): ~0.45 announcements per question — almost none on
// easy questions, ~73% of medium and ~95% of hard reveals.
export const DEFAULT_EVIDENCE: EvidenceParams = {
  loneMinTier: "medium",
  minAnswerers: 3,
  lightningMaxMs: 3000,
  lightningRatio: 0.6,
  lightningMinTier: "medium",
  streakLen: 6,
  hardSweepMin: 2,
  nearLineGap: 300,
  crowdMinShare: 0.6,
  silentEnabled: false,
};

const TIER_RANK: Record<Tier, number> = { easy: 0, medium: 1, hard: 2 };

export interface RevealInput {
  questionIdx: number;
  tier: Tier;
  rows: RevealRow[];
  scores: Record<string, number>; // after this question
  threshold: number;
  activeIds: string[]; // players eligible to be called out (not banished)
}

export interface EvidenceResult {
  candidates: Callout[]; // everything that fired
  selected: Callout | null; // the one the reveal will actually announce
}

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Tracks one match's public history and produces callouts per reveal.
 *  Deterministic: the same reveal sequence always yields the same callouts,
 *  so every phone computes identical evidence without extra network traffic. */
export class EvidenceTracker {
  private streak: Record<string, number> = {};
  private hardSeen = 0;
  private hardCorrect: Record<string, number> = {};
  private nearLineFiredAtGap = Infinity;
  private lastKind: CalloutKind | null = null;
  /** Players proven innocent by sitting at/above the line with no siren. */
  readonly cleared = new Set<string>();
  readonly history: EvidenceResult[] = [];

  constructor(private params: EvidenceParams = DEFAULT_EVIDENCE) {}

  /** After a wrong detention drops the line and the match CONTINUES, anyone
   *  now at/above it is proven innocent immediately (not at the next reveal).
   *  Only call when the cheater is known to be below the line. */
  clearAtOrAbove(threshold: number, scores: Record<string, number>, activeIds: string[]): string[] {
    const fresh = activeIds.filter((id) => (scores[id] ?? 0) >= threshold && !this.cleared.has(id));
    for (const id of fresh) this.cleared.add(id);
    return fresh;
  }

  add(r: RevealInput): EvidenceResult {
    const p = this.params;
    const candidates: Callout[] = [];

    // The threshold check has already run when a reveal is shown, so anyone
    // at or above the line here cannot be the cheater.
    const newlyCleared = r.activeIds.filter((id) => (r.scores[id] ?? 0) >= r.threshold && !this.cleared.has(id));
    for (const id of newlyCleared) this.cleared.add(id);
    if (newlyCleared.length) candidates.push({ kind: "cleared", subjectIds: newlyCleared, priority: 8, detail: { threshold: r.threshold } });

    // Callouts that point suspicion only consider players not yet cleared.
    const active = new Set(r.activeIds.filter((id) => !this.cleared.has(id)));
    const answered = r.rows.filter((row) => row.pick !== -1);
    const correct = r.rows.filter((row) => row.correct);
    const tierRank = TIER_RANK[r.tier];

    // Running stats update first (streaks include this question).
    for (const row of r.rows) this.streak[row.playerId] = row.correct ? (this.streak[row.playerId] ?? 0) + 1 : 0;
    if (r.tier === "hard") {
      this.hardSeen++;
      for (const row of r.rows) if (row.correct) this.hardCorrect[row.playerId] = (this.hardCorrect[row.playerId] ?? 0) + 1;
    }

    const enoughAnswers = answered.length >= p.minAnswerers;

    // lone_correct / against_crowd
    if (enoughAnswers && tierRank >= TIER_RANK[p.loneMinTier] && correct.length === 1 && active.has(correct[0].playerId)) {
      candidates.push({ kind: "lone_correct", subjectIds: [correct[0].playerId], priority: r.tier === "hard" ? 6 : 5, detail: { timeMs: correct[0].timeMs } });
    }
    if (enoughAnswers && correct.length >= 1 && correct.length <= 2) {
      const wrongPicks: Record<number, number> = {};
      for (const row of answered) if (!row.correct) wrongPicks[row.pick] = (wrongPicks[row.pick] ?? 0) + 1;
      const biggest = Math.max(0, ...Object.values(wrongPicks));
      if (biggest / answered.length >= p.crowdMinShare) {
        const subj = correct.map((c) => c.playerId).filter((id) => active.has(id));
        if (subj.length) candidates.push({ kind: "against_crowd", subjectIds: subj, priority: 4, detail: { crowd: biggest } });
      }
    }

    // lightning
    if (enoughAnswers && tierRank >= TIER_RANK[p.lightningMinTier] && correct.length) {
      const fastest = correct.reduce((a, b) => (b.timeMs < a.timeMs ? b : a));
      const others = answered.filter((row) => row.playerId !== fastest.playerId).map((row) => row.timeMs);
      const roomMedian = median(others);
      if (active.has(fastest.playerId) && fastest.timeMs <= p.lightningMaxMs && roomMedian > 0 && fastest.timeMs <= roomMedian * p.lightningRatio) {
        candidates.push({ kind: "lightning", subjectIds: [fastest.playerId], priority: 4, detail: { timeMs: fastest.timeMs, roomMedianMs: Math.round(roomMedian) } });
      }
    }

    // streak (fires on reaching streakLen, then every +2)
    for (const row of r.rows) {
      const s = this.streak[row.playerId];
      if (active.has(row.playerId) && s >= p.streakLen && (s - p.streakLen) % 2 === 0) {
        candidates.push({ kind: "streak", subjectIds: [row.playerId], priority: s >= p.streakLen + 2 ? 4 : 3, detail: { streak: s } });
      }
    }

    // hard_sweep (only on hard questions, once enough hard ones have been asked)
    if (r.tier === "hard" && this.hardSeen >= p.hardSweepMin) {
      const sweepers = r.rows.filter((row) => (this.hardCorrect[row.playerId] ?? 0) === this.hardSeen && active.has(row.playerId)).map((row) => row.playerId);
      if (sweepers.length && sweepers.length <= 2) candidates.push({ kind: "hard_sweep", subjectIds: sweepers, priority: 5, detail: { hard: this.hardSeen } });
    }

    // near_line: fire when the top score first gets within the gap, and again
    // if it closes to half the gap.
    const ranked = Object.entries(r.scores).filter(([id]) => active.has(id)).sort((a, b) => b[1] - a[1]);
    if (ranked.length) {
      const gap = r.threshold - ranked[0][1];
      const top = ranked.filter(([, s]) => s === ranked[0][1]).map(([id]) => id);
      if (gap > 0 && gap <= p.nearLineGap && (this.nearLineFiredAtGap === Infinity || (gap <= p.nearLineGap / 2 && this.nearLineFiredAtGap > p.nearLineGap / 2))) {
        this.nearLineFiredAtGap = gap;
        candidates.push({ kind: "near_line", subjectIds: top, priority: 7, detail: { gap } });
      }
    }

    // stumper
    if (enoughAnswers && correct.length === 0) candidates.push({ kind: "stumper", subjectIds: [], priority: r.tier === "easy" ? 3 : 2, detail: {} });

    // silent
    if (p.silentEnabled) {
      for (const row of r.rows) if (row.pick === -1 && active.has(row.playerId)) candidates.push({ kind: "silent", subjectIds: [row.playerId], priority: 1, detail: {} });
    }

    // Select one: highest priority, avoid repeating last kind when there's
    // an alternative, ties broken by kind order for determinism.
    const ordered = [...candidates].sort((a, b) => b.priority - a.priority || a.kind.localeCompare(b.kind));
    let selected = ordered[0] ?? null;
    if (selected && selected.kind === this.lastKind && selected.kind !== "near_line") {
      const alt = ordered.find((c) => c.kind !== this.lastKind);
      if (alt && alt.priority >= selected.priority - 1) selected = alt;
    }
    this.lastKind = selected?.kind ?? null;
    const result = { candidates, selected };
    this.history.push(result);
    return result;
  }
}
