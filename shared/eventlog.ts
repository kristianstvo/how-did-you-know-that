// Match event log, derived ONLY from public state snapshots. The simulator
// writes it today; after sign-off the host's browser writes the same format
// during real playtests, so one analyzer compares simulation and reality.
import type { MatchEndReason, PublicState, RevealRow, Tier } from "./protocol";

export const EVENT_LOG_VERSION = 1;

interface Base {
  t: number; // host epoch ms
  match: number;
}
export type MatchEvent =
  | (Base & { type: "matchStart"; players: { id: string; name: string; isBot: boolean }[]; threshold: number; questionTimerMs: number })
  | (Base & { type: "question"; q: number; tier: Tier; subject: string; points: number })
  | (Base & { type: "lock"; q: number; playerId: string })
  | (Base & {
      type: "reveal";
      q: number;
      tier: Tier;
      points: number;
      correctIdx: number;
      rows: RevealRow[];
      scores: Record<string, number>;
      threshold: number;
      banished: string[];
      // True when this reveal arrived with the match-end state (the answer
      // that pushed the cheater over the line). It is never shown as a normal
      // reveal, so no evidence callouts are computed for it.
      final: boolean;
      // What the room was actually shown (absent in simulator logs, which the
      // analyzer recomputes): the announced callout and who is CLEARED.
      callout?: { kind: string; subjectIds: string[] } | null;
      cleared?: string[];
    })
  | (Base & { type: "accuse"; q: number; accuserId: string })
  | (Base & {
      type: "voteResult";
      q: number;
      accuserId: string;
      votes: Record<string, string>;
      banishedId: string | null;
      wasCheater: boolean;
      tie: boolean;
      newThreshold: number | null;
    })
  | (Base & {
      type: "point";
      q: number;
      from: string;
      to: string | null;
    })
  | (Base & {
      type: "matchEnd";
      q: number;
      reason: MatchEndReason;
      struckOut?: boolean;
      cheaterId: string;
      winnerIds: string[];
      scores: Record<string, number>;
      threshold: number;
    });

/** Feed every public snapshot (with its timestamp); events come out once each. */
export function createEventLogger(emit: (e: MatchEvent) => void): (s: PublicState, t: number) => void {
  let match = 0; // counts periods itself (New day restarts s.matchNumber)
  let lastMatchNumber = -1;
  let lastPhase = "";
  let lastQ = -1;
  const revealed = new Set<string>();
  let voteKey = "";
  let resultKey = "";
  let locked = new Set<string>();
  let pointers = new Map<string, string | null>(); // v0.5: who points at whom

  const revealEvent = (s: PublicState, t: number) => {
    const m = s.match!;
    const key = `${match}:${m.questionIdx}`;
    if (!m.reveal || !m.question || revealed.has(key)) return;
    revealed.add(key);
    emit({
      type: "reveal",
      t,
      match,
      q: m.questionIdx,
      tier: m.question.tier,
      points: m.question.points,
      correctIdx: m.reveal.correctIdx,
      rows: m.reveal.rows,
      scores: Object.fromEntries(s.players.map((p) => [p.id, p.score])),
      threshold: m.threshold,
      banished: s.players.filter((p) => p.banished).map((p) => p.id),
      final: s.phase === "matchEnd",
      callout: m.reveal.callout ? { kind: m.reveal.callout.kind, subjectIds: m.reveal.callout.subjectIds } : null,
      cleared: [...(m.cleared ?? [])],
    });
  };

  return (s, t) => {
    const m = s.match;
    if (s.phase === "role" && (lastPhase !== "role" || s.matchNumber !== lastMatchNumber)) {
      match += 1;
      lastMatchNumber = s.matchNumber;
      lastQ = -1;
      revealed.clear();
      emit({
        type: "matchStart",
        t,
        match,
        players: s.players.filter((p) => p.connected).map((p) => ({ id: p.id, name: p.name, isBot: p.isBot })),
        threshold: m?.threshold ?? s.settings.threshold,
        questionTimerMs: s.settings.questionTimerMs,
      });
      pointers = new Map(s.players.map((p) => [p.id, null]));
    }
    if (m && s.phase !== "matchEnd") {
      for (const p of s.players) {
        const to = p.pointingAt ?? null;
        if ((pointers.get(p.id) ?? null) !== to) {
          pointers.set(p.id, to);
          emit({ type: "point", t, match, q: m.questionIdx, from: p.id, to });
        }
      }
    }
    if (m && s.phase === "question") {
      if (m.questionIdx !== lastQ) {
        lastQ = m.questionIdx;
        locked = new Set();
        emit({ type: "question", t, match, q: m.questionIdx, tier: m.question!.tier, subject: m.question!.subject, points: m.question!.points });
      }
      for (const p of s.players) {
        if (p.answeredCurrent && !locked.has(p.id)) {
          locked.add(p.id);
          emit({ type: "lock", t, match, q: m.questionIdx, playerId: p.id });
        }
      }
    }
    if (m && (s.phase === "reveal" || s.phase === "matchEnd")) revealEvent(s, t);
    if (m && s.phase === "vote" && m.vote) {
      const key = `${match}:${m.questionIdx}:${m.vote.accuserId}`;
      if (key !== voteKey) {
        voteKey = key;
        emit({ type: "accuse", t, match, q: m.questionIdx, accuserId: m.vote.accuserId });
      }
    }
    if (m && s.phase === "voteResult" && m.voteResult) {
      const key = `${match}:${m.questionIdx}:${m.voteResult.accuserId}`;
      if (key !== resultKey) {
        resultKey = key;
        const vr = m.voteResult;
        emit({ type: "voteResult", t, match, q: m.questionIdx, accuserId: vr.accuserId, votes: vr.votes, banishedId: vr.banishedId, wasCheater: vr.wasCheater, tie: vr.tie, newThreshold: vr.newThreshold });
      }
    }
    if (m && s.phase === "matchEnd" && m.end && lastPhase !== "matchEnd") {
      emit({
        type: "matchEnd",
        t,
        match,
        q: m.questionIdx,
        reason: m.end.reason,
        ...(m.end.struckOut ? { struckOut: true } : {}),
        cheaterId: m.end.cheaterId,
        winnerIds: m.end.winnerIds,
        scores: Object.fromEntries(s.players.map((p) => [p.id, p.score])),
        threshold: m.threshold,
      });
    }
    lastPhase = s.phase;
  };
}
