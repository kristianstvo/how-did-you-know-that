// Choreography: beat timelines for every staged screen, as pure functions of
// PUBLIC data. The host engine uses them to gate accusations and the Next
// button; every phone uses the same functions to render beats against the
// shared server clock. Nothing here may depend on who the cheater is — the
// cheater's screen must run the exact same timeline as everyone else's.
// Numbers: see 08-reveal-direction.md (beat sheet).
import type { Callout } from "./evidence";
import type { Tier } from "./protocol";

export type Stakes = "low" | "mid" | "high";

/** Ceremony scales with what's at stake (design/research-reveal-pacing.md
 *  principles 1, 2, 6, 12): quick on settled easy questions, full drama on
 *  hard ones, on strong evidence, and on the LAST BELL. */
export function revealStakes(tier: Tier, callout: Callout | null, lastBell: boolean): Stakes {
  const strong = callout && ["near_line", "cleared", "lone_correct", "hard_sweep", "against_crowd"].includes(callout.kind);
  if (tier === "hard" || strong || lastBell) return "high";
  if (tier === "medium" || callout) return "mid";
  return "low";
}

/** LAST BELL: players (not proven innocent) who would graduate if they are
 *  the cheater and answer the NEXT question right. Derived from public state,
 *  so it follows lobby lines and detention drops (default line: the Q7
 *  reveal; after two wrong detentions: Q6; with a 1600 line: Q8). */
export function lastBellIds(scores: Record<string, number>, suspectIds: string[], threshold: number, nextPoints: number | null): string[] {
  if (nextPoints === null) return [];
  return suspectIds.filter((id) => (scores[id] ?? 0) + nextPoints >= threshold);
}

export type RevealBeat = "pencils" | "slap" | "drumroll" | "answer" | "verdict" | "evidence" | "grade" | "accuse";

interface RevealTiming {
  slapAt: number; // first avatar lands
  slapStagger: number; // between avatars (fastest answerer lands first)
  drumroll: number; // hold after the last avatar before the answer lights
  verdictAfter: number; // answer → ✓/✗ stamps, times, +points
  evidenceAfter: number; // verdicts → callout card (if any)
  evidenceHold: number; // time the callout owns the screen before the grade book
  gradeAfter: number; // → grade book animates (no callout)
  accuseAfter: number; // grade book → accuse arms
}

export const REVEAL_TIMING: Record<Stakes, RevealTiming> = {
  // Information-bearing staggers stay ≥110ms (> 2× the ±50ms clock tolerance)
  // so the slap ORDER (= speed order) reads the same on every phone.
  // accuseAfter ≥ the grade book's --t-drama (700ms) + a frame: nothing that
  // carries information may still be moving when ACCUSE arms.
  low: { slapAt: 250, slapStagger: 110, drumroll: 300, verdictAfter: 350, evidenceAfter: 400, evidenceHold: 1100, gradeAfter: 350, accuseAfter: 750 },
  mid: { slapAt: 400, slapStagger: 140, drumroll: 800, verdictAfter: 450, evidenceAfter: 550, evidenceHold: 1300, gradeAfter: 450, accuseAfter: 750 },
  high: { slapAt: 600, slapStagger: 190, drumroll: 1400, verdictAfter: 600, evidenceAfter: 700, evidenceHold: 1600, gradeAfter: 600, accuseAfter: 750 },
};

/** Minimum talk time after the accuse button arms before the host may move
 *  on (≈1s silence + 2×400ms voice latency + reaction; pacing brief §7). */
export const TALK_HOLD_MS = 2500;

export interface Timeline<B extends string> {
  beats: Record<B, number>; // ms from phase start
  end: number; // last beat
}

export function revealTimeline(stakes: Stakes, playerCount: number, hasCallout: boolean): Timeline<RevealBeat> {
  const t = REVEAL_TIMING[stakes];
  const slap = t.slapAt;
  const lastSlap = slap + Math.max(0, playerCount - 1) * t.slapStagger;
  const drumroll = lastSlap + 250;
  const answer = drumroll + t.drumroll;
  const verdict = answer + t.verdictAfter;
  const evidence = hasCallout ? verdict + t.evidenceAfter : verdict;
  const grade = hasCallout ? evidence + t.evidenceHold : verdict + t.gradeAfter;
  const accuse = grade + t.accuseAfter;
  return { beats: { pencils: 0, slap, drumroll, answer, verdict, evidence, grade, accuse }, end: accuse };
}

/** When avatar i (in answer-time order, fastest first) lands. */
export function slapAt(stakes: Stakes, i: number): number {
  const t = REVEAL_TIMING[stakes];
  return t.slapAt + i * t.slapStagger;
}

/** v0.23: the accused has the floor before ballots open, so a defence never
 *  has to race the clock. A bot has nothing to say: it gets a short floor
 *  (isBot is public, so every phone runs the same timeline). */
export const VOTE_FLOOR_MS = 5000;
export const VOTE_FLOOR_BOT_MS = 2000;
/** A ballot this early is still taken: a tap made the instant ballots open
 *  may reach the host a little before its clock says so. */
export const VOTE_EARLY_MS = 300;

export type VoteResultBeat = "sealed" | "flip" | "verdict" | "drop" | "done";
export const VOTE_FLIP_STAGGER = 260;

export function voteResultTimeline(voteCount: number, thresholdDropped: boolean): Timeline<VoteResultBeat> {
  const flip = 700;
  const lastFlip = flip + Math.max(0, voteCount - 1) * VOTE_FLIP_STAGGER;
  const verdict = lastFlip + 1300; // drumroll before the stamp
  const drop = thresholdDropped ? verdict + 1100 : verdict;
  const done = drop + (thresholdDropped ? 1400 : 900);
  return { beats: { sealed: 0, flip, verdict, drop, done }, end: done };
}

export type MatchEndBeat = "takeover" | "drumroll" | "unmask" | "finalBlow" | "scores" | "caseFile" | "session" | "done";

export function matchEndTimeline(reason: "cheater_banished" | "cheater_threshold" | "top_score"): Timeline<MatchEndBeat> {
  // Graduation is an instant siren takeover with no drumroll (spec 01/07);
  // the other endings hold the cheater's identity for a beat first.
  // A graduation first shows the answer that did it (final blow), then the
  // unmask; the other endings hold the identity through a drumroll.
  const graduated = reason === "cheater_threshold";
  const drumroll = graduated ? 0 : 700;
  const finalBlow = graduated ? 300 : 2500;
  const unmask = graduated ? 1300 : 2500;
  const scores = unmask + 1100;
  const caseFile = scores + 1100;
  const session = caseFile + 1300;
  const done = session + 900;
  return { beats: { takeover: 0, drumroll, unmask, finalBlow, scores, caseFile, session, done }, end: done };
}

export type RoleBeat = "bell" | "line1" | "line2" | "role";
export const ROLE_TIMELINE: Timeline<RoleBeat> = { beats: { bell: 0, line1: 350, line2: 1000, role: 1700 }, end: 1700 };
export const ROLE_SCREEN_MS = 3200;
/** v0.19: with a big screen in the room, the bell holds until its host has
 *  opened the period (both intros end by 6s), so "Question one!" lands on
 *  question one instead of under her intro. */
export const ROLE_SCREEN_TV_MS = 6400;

/** Which beats have been reached at `elapsed` ms. */
export function reached<B extends string>(tl: Timeline<B>, elapsed: number): Set<B> {
  const out = new Set<B>();
  for (const [b, at] of Object.entries(tl.beats) as [B, number][]) if (elapsed >= at) out.add(b);
  return out;
}
