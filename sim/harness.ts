// Headless simulation harness. Runs the REAL HostEngine with a virtual clock
// and seeded randomness. Simulated phones join and act through the real
// protocol (joinRequest → state/secret events → intents), so the cheater only
// ever learns answers through the same private channel a real phone uses.
import { HostEngine, type Transport } from "../client/src/engine";
import { localOnlySource, resetLocalDeck, type QuestionSource } from "../client/src/providers";
import { createEventLogger, type MatchEvent } from "../shared/eventlog";
import { EvidenceTracker, DEFAULT_EVIDENCE, type CalloutKind, type EvidenceParams } from "../shared/evidence";
import { DEFAULT_HUMAN, logit, lognormal, normal, sigmoid, type Accuracy, type HumanModel } from "../shared/humanModel";
import { voteResultTimeline } from "../shared/choreo";
import {
  AVATARS,
  type Intent,
  type PublicState,
  type Question,
  type SecretState,
  type Tier,
} from "../shared/protocol";

// ---------------- Randomness ----------------

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashSeed(...parts: (string | number)[]): number {
  let h = 2166136261;
  for (const ch of parts.join("|")) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// ---------------- Virtual clock ----------------

const realSetImmediate = globalThis.setImmediate;

const EPOCH = 1_800_000_000_000;

export class VirtualClock {
  now = EPOCH;
  private queue: { t: number; seq: number; fn: () => void }[] = [];
  private seq = 0;

  install(): void {
    Date.now = () => this.now;
    (globalThis as { setTimeout: unknown }).setTimeout = (fn: (...a: unknown[]) => void, ms?: number, ...args: unknown[]) => {
      this.queue.push({ t: this.now + Math.max(0, ms ?? 0), seq: this.seq++, fn: () => fn(...args) });
      return this.seq;
    };
  }

  /** Fresh timeline per match: same seed → byte-identical log, regardless of
   *  what ran before in this process. */
  reset(): void {
    this.queue = [];
    this.now = EPOCH;
  }

  async runUntil(done: () => boolean, maxEvents = 200_000): Promise<void> {
    const flush = () => new Promise<void>((r) => realSetImmediate(r));
    for (let i = 0; i < maxEvents; i++) {
      await flush();
      if (done()) return;
      if (!this.queue.length) throw new Error("simulation stalled: no pending timers");
      let mi = 0;
      for (let j = 1; j < this.queue.length; j++) {
        const a = this.queue[j];
        const b = this.queue[mi];
        if (a.t < b.t || (a.t === b.t && a.seq < b.seq)) mi = j;
      }
      const ev = this.queue.splice(mi, 1)[0];
      this.now = Math.max(this.now, ev.t);
      ev.fn();
    }
    throw new Error("simulation exceeded event budget");
  }
}

// ---------------- Player models ----------------

export type { Accuracy, HumanModel };
export { DEFAULT_HUMAN };
export type Strategy = "naive" | "mimic" | "careful" | "sprint";
// none: nobody accuses. score: suspect the leader. scoreAware: suspect the
// leader but never a player the reveal has CLEARED. evidence: accumulate the
// announced callouts (and respect CLEARED).
// circle: the whole class agrees to send everyone to detention in seat order,
// ignoring the evidence, until the cheater is caught. The person after the
// one on the spot accuses them (v0.23: nobody may accuse themselves); if they
// won't (the cheater never does), the next in line does. circleInformed: the
// same sweep, ordered by the announced evidence and then by score instead of
// by seat. Both skip players the reveal has CLEARED.
export type Policy = "none" | "score" | "scoreAware" | "evidence" | "circle" | "circleInformed";

/** Experimental rule variants, applied by the harness around the real engine
 *  (sim only; the shipped rules are the defaults). */
export interface RuleVariant {
  onePerReveal?: boolean; // after a vote, ACCUSE stays closed until the next question
  accuseFromQ?: number; // no accusations before this question's reveal (0-based)
}

export interface Scenario {
  name: string;
  players: number; // including host
  accuracy: Accuracy;
  strategy: Strategy;
  policy: Policy;
  matches: number;
  seed: number;
  mode: "clients" | "builtinBots";
  threshold?: number; // override the lobby default
  strikes?: number; // override the lobby default (0 = the pre-v0.4 rules: no strike-out)
  questionSource?: "sim" | "local"; // "local" = real question text from the bundled pack
  names?: string[]; // display names by seat (host first)
  record?: boolean; // capture a replay tape of every state/secret
  human?: HumanModel;
  evidence?: EvidenceParams;
  sweepFrom?: number; // circle policies: the first reveal (0-based question) the sweep runs in
  rules?: RuleVariant;
}

const isCircle = (p: Policy) => p === "circle" || p === "circleInformed";

const CALLOUT_WEIGHT: Record<CalloutKind, number> = {
  lone_correct: 2,
  against_crowd: 1.5,
  lightning: 1.5,
  streak: 1,
  hard_sweep: 2,
  near_line: 1,
  stumper: 0,
  silent: 0,
  cleared: 0,
};

/** What a simulated human "knows" — the harness's oracle for the question
 *  being asked. Innocent players draw on it the way real people draw on
 *  general knowledge; the cheater must NOT use it (it reads its secret). */
interface Oracle {
  correctIdx(q: number): number;
  distractorWeights(q: number): number[];
  itemIntensity(q: number): number; // shared log time-intensity of question q
}

interface Integrity {
  cheaterSecretMismatches: number;
  innocentSecretLeaks: number;
}

class SimPhone {
  playerId = "";
  state: PublicState | null = null;
  secret: SecretState = { isCheater: false, correctIdx: -1 };
  // Two independent streams: answering behaviour is identical across cheater
  // strategies and room policies (paired comparisons); social behaviour
  // (accusing, voting, host pacing) varies with them.
  private rng: () => number;
  private social: () => number;
  private ability: number;
  private speed: number;
  private plannedQ = -1;
  private phaseSeq = 0; // bumps on every phase change; stale host timers bail
  private evidence: EvidenceTracker;
  private evidenceQ = new Set<number>();
  private suspicion: Record<string, number> = {};
  private votedInQ = -1; // the question whose reveal last held a vote

  constructor(
    readonly socketId: string,
    readonly isHost: boolean,
    private sc: Scenario,
    private human: HumanModel,
    private oracle: Oracle,
    private send: (intent: Intent) => void,
    private hostAdvance: () => void,
    private integrity: Integrity,
    answerSeed: number,
    socialSeed: number,
  ) {
    this.rng = mulberry32(answerSeed);
    this.social = mulberry32(socialSeed);
    this.ability = normal(this.rng) * human.abilitySd;
    this.speed = normal(this.rng) * human.speedSd;
    this.evidence = new EvidenceTracker(sc.evidence ?? DEFAULT_EVIDENCE);
  }

  receive(event: string, payload: unknown): void {
    if (event === "joined") {
      const j = payload as { playerId: string; state: PublicState; secret: SecretState };
      this.playerId = j.playerId;
      this.secret = j.secret;
      this.onState(j.state);
    } else if (event === "state") this.onState((payload as { state: PublicState }).state);
    else if (event === "secret") this.secret = (payload as { secret: SecretState }).secret;
  }

  private me() {
    return this.state?.players.find((p) => p.id === this.playerId);
  }

  private onState(s: PublicState): void {
    const prev = this.state;
    this.state = s;
    const m = s.match;
    if (!m) return;
    // Bump before planning, so timers set below see the new phase's number.
    if (s.phase !== prev?.phase) this.phaseSeq++;
    if (s.phase === "question" && m.questionIdx !== this.plannedQ) {
      this.plannedQ = m.questionIdx;
      this.planAnswer(m.questionIdx, m.question!.tier, s.settings.questionTimerMs);
    }
    if (s.phase === "reveal" && m.reveal && !this.evidenceQ.has(m.questionIdx)) {
      this.evidenceQ.add(m.questionIdx);
      const res = this.evidence.add({
        questionIdx: m.questionIdx,
        tier: m.question!.tier,
        rows: m.reveal.rows,
        scores: Object.fromEntries(s.players.map((p) => [p.id, p.score])),
        threshold: m.threshold,
        activeIds: s.players.filter((p) => !p.banished).map((p) => p.id),
      });
      if (res.selected) for (const id of res.selected.subjectIds) this.suspicion[id] = (this.suspicion[id] ?? 0) + CALLOUT_WEIGHT[res.selected.kind];
      this.planPointer(s);
      this.planAccusation(s);
    } else if (s.phase === "reveal" && prev?.phase === "voteResult") {
      // Back from a vote on the same reveal: the room may accuse again.
      this.planAccusation(s);
    }
    if (s.phase === "vote" && prev?.phase !== "vote") {
      this.votedInQ = m.questionIdx;
      this.planVote(s);
    }
    if (this.isHost && s.phase !== prev?.phase) {
      const seq = this.phaseSeq;
      const advanceIfStill = (ms: number) =>
        setTimeout(() => {
          if (this.phaseSeq === seq) this.hostAdvance(); // a real host taps what's on screen
        }, ms);
      if (s.phase === "reveal" && m.reveal) {
        // A sweeping class holds the host until the next person in line has
        // had their chance to accuse.
        advanceIfStill(Math.max(0, m.reveal.minNextAt - Date.now(), this.sweepHoldMs(s)) + lognormal(this.social, this.human.hostAdvanceRt.median, this.human.hostAdvanceRt.sigma));
      }
      if (s.phase === "voteResult" && m.voteResult) {
        // The Continue button appears when the vote-result show ends.
        const tl = voteResultTimeline(Object.keys(m.voteResult.votes).length, m.voteResult.newThreshold !== null);
        advanceIfStill(Math.max(0, s.phaseStartedAt + tl.end - Date.now()) + 1500);
      }
    }
  }

  private planAnswer(q: number, tier: Tier, timerMs: number): void {
    const h = this.human;
    const strategy = this.sc.strategy;
    // Draw everything up front in a fixed order so paired scenarios stay aligned.
    const pKnow = sigmoid(logit(h.pKnow[this.sc.accuracy][tier]) + this.ability);
    const knows = this.rng() < pKnow;
    const pace = this.speed + this.oracle.itemIntensity(q);
    const shifted = (median: number, sigma: number) => h.shiftMs + (median - h.shiftMs) * Math.exp(sigma * normal(this.rng) + pace);
    const kRt = shifted(h.knowMedianMs[tier], h.knowSigma);
    const rapid = this.rng() < h.rapidGuessShare;
    const rapidRt = lognormal(this.rng, h.rapidGuess.median, h.rapidGuess.sigma);
    const slowRt = shifted(h.guessMedianMs[tier], h.guessSigma);
    const gRt = rapid ? rapidRt : slowRt;
    const naiveRt = lognormal(this.rng, 2000, 0.35);
    const u = this.rng();
    const guessRight = this.rng() < h.guessAccuracy;
    const guessU = this.rng();
    const wrongU = this.rng();
    const lastSecond = this.rng() < h.lastSecondTap;
    const lastSecondRt = timerMs - 1500 + this.rng() * 1400;

    const decide = (): { pick: number; rt: number } => {
      const cheater = this.secret.isCheater;
      const guess = () => {
        const truth = this.oracle.correctIdx(q);
        if (guessRight) return truth;
        // Wrong guesses favour the question's attractive distractors.
        const w = this.oracle.distractorWeights(q).map((x, i) => (i === truth ? 0 : x));
        const total = w.reduce((a, b) => a + b, 0);
        let x = guessU * total;
        for (let i = 0; i < 4; i++) {
          x -= w[i];
          if (x <= 0 && w[i] > 0) return i;
        }
        return [0, 1, 2, 3].find((i) => i !== truth)!;
      };
      const wrong = () => {
        const truth = this.secret.correctIdx;
        const opts = [0, 1, 2, 3].filter((i) => i !== truth);
        return opts[Math.floor(wrongU * opts.length)];
      };
      const asInnocent = () => (knows ? { pick: this.oracle.correctIdx(q), rt: kRt } : { pick: guess(), rt: gRt });
      if (!cheater) return asInnocent();
      const sec = this.secret.correctIdx;
      switch (strategy) {
        case "naive":
          return { pick: sec, rt: naiveRt };
        case "mimic":
          return { pick: sec, rt: kRt };
        case "careful": {
          const pRight = tier === "easy" ? 0.85 : tier === "medium" ? 0.7 : 1;
          return u < pRight ? { pick: sec, rt: kRt } : { pick: wrong(), rt: gRt };
        }
        case "sprint":
          return q >= 7 ? { pick: sec, rt: kRt } : asInnocent();
      }
    };

    // Decide on the next tick: the engine sends this question's secret right
    // after the question state, exactly as a real phone receives it.
    const startedAt = Date.now();
    setTimeout(() => {
      const truth = this.oracle.correctIdx(q);
      if (this.secret.isCheater && this.secret.correctIdx !== truth) this.integrity.cheaterSecretMismatches++;
      if (!this.secret.isCheater && this.secret.correctIdx !== -1) this.integrity.innocentSecretLeaks++;
      const d = decide();
      if (d.rt >= timerMs - 250) {
        // Out of time: most people stab at an answer in the last seconds.
        if (!lastSecond) return;
        d.rt = lastSecondRt;
      }
      setTimeout(() => {
        this.send({ kind: "answer", questionIdx: q, optionIdx: d.pick, clientElapsedMs: Math.round(Date.now() - startedAt) });
      }, Math.max(0, startedAt + d.rt - Date.now()));
    }, 0);
  }

  private eligible(): boolean {
    const me = this.me();
    return !!me && !me.tokenUsed && !me.banished && me.votingRights;
  }

  /** Who this player would consider: everyone else not banished, minus
   *  CLEARED players when the room understands the line. */
  private suspects(s: PublicState) {
    const aware = this.sc.policy === "evidence" || this.sc.policy === "scoreAware";
    return s.players.filter((p) => p.id !== this.playerId && !p.banished && !(aware && this.evidence.cleared.has(p.id)));
  }

  /** Can anyone accuse in this reveal under the scenario's rules? A real room
   *  knows its own rules, so a sweeping class doesn't waste attempts. */
  private accuseOpen(s: PublicState): boolean {
    const m = s.match;
    if (!m) return false;
    const r = this.sc.rules ?? {};
    if (m.questionIdx < (r.accuseFromQ ?? 0)) return false;
    return !(r.onePerReveal && this.votedInQ === m.questionIdx);
  }

  /** The sweep's shared running order — every phone computes the same list
   *  from public data. Banished and CLEARED players are skipped. */
  private circleOrder(s: PublicState): string[] {
    const live = s.players.filter((p) => !p.banished && !this.evidence.cleared.has(p.id));
    if (this.sc.policy === "circleInformed") {
      // Stable sort: equal suspicion and score fall back to seat order.
      live.sort((a, b) => (this.suspicion[b.id] ?? 0) - (this.suspicion[a.id] ?? 0) || b.score - a.score);
    }
    return live.map((p) => p.id);
  }

  /** Who may step up to accuse the next in line, in line order after them
   *  (v0.23: an accusation names someone else, so the target can't). */
  private sweepAccusers(s: PublicState): string[] {
    const order = this.circleOrder(s);
    return order
      .slice(1)
      .map((id) => s.players.find((p) => p.id === id)!)
      .filter((p) => !p.tokenUsed && !p.banished && p.votingRights)
      .map((p) => p.id);
  }

  private sweepActive(s: PublicState): boolean {
    const m = s.match;
    return !!m && isCircle(this.sc.policy) && m.questionIdx >= (this.sc.sweepFrom ?? 0) && this.accuseOpen(s) && this.circleOrder(s).length >= 2;
  }

  /** How long the host should wait before tapping Next during a sweep. */
  private sweepHoldMs(s: PublicState): number {
    if (!this.sweepActive(s)) return 0;
    const armed = Math.max(0, (s.match?.reveal?.accuseAt ?? Date.now()) - Date.now());
    return armed + 600 + this.sweepAccusers(s).length * 2500 + 1500;
  }

  /** v0.5: point at the top suspect once the board is graded (the cheater
   *  bluffs the same way). Deterministic, no randomness drawn: pointing never
   *  changes an outcome, so balance results stay comparable. */
  private planPointer(s: PublicState): void {
    const policy = this.sc.policy;
    const me = this.me();
    if (policy === "none" || isCircle(policy) || !me) return;
    const others = this.suspects(s);
    if (!others.length) return;
    let top: string | null = null;
    if (policy === "evidence") {
      const ranked = others.map((p) => ({ id: p.id, s: this.suspicion[p.id] ?? 0 })).sort((a, b) => b.s - a.s);
      if (ranked[0].s >= 1) top = ranked[0].id;
    } else {
      const lead = [...others].sort((a, b) => b.score - a.score)[0];
      if (lead.score >= 0.5 * s.match!.threshold) top = lead.id;
    }
    if (!top || top === (me.pointingAt ?? null)) return;
    const armed = Math.max(0, (s.match?.reveal?.accuseAt ?? Date.now()) - Date.now());
    const seq = this.phaseSeq;
    setTimeout(() => {
      if (this.phaseSeq === seq) this.send({ kind: "point", targetPlayerId: top });
    }, armed + 400);
  }

  private planAccusation(s: PublicState): void {
    const policy = this.sc.policy;
    if (isCircle(policy)) {
      if (this.secret.isCheater || !this.eligible() || !this.sweepActive(s)) return;
      // The next person in line accuses the one on the spot; each later
      // person waits a little longer, in case the ones before them won't.
      const rank = this.sweepAccusers(s).indexOf(this.playerId);
      if (rank < 0) return;
      const target = this.circleOrder(s)[0];
      const armed = Math.max(0, (s.match?.reveal?.accuseAt ?? Date.now()) - Date.now());
      const seq = this.phaseSeq;
      setTimeout(() => {
        if (this.phaseSeq === seq) this.send({ kind: "burnToken", targetPlayerId: target });
      }, armed + 600 + rank * 2500 + this.social() * 400);
      return;
    }
    if (policy === "none" || !this.eligible() || this.secret.isCheater) return;
    const others = this.suspects(s);
    if (!others.length) return;
    let fire = false;
    let target = "";
    // On the last strike a wrong detention ends the match: people want more.
    const lastStrike = s.settings.strikes > 0 && s.match!.wrongDetentions === s.settings.strikes - 1;
    // v0.23: they name the one they would vote for (the lead rules out a tie).
    if (policy === "score" || policy === "scoreAware") {
      const sorted = [...others].sort((a, b) => b.score - a.score);
      const lead = sorted[0].score - (sorted[1]?.score ?? 0);
      fire = sorted[0].score >= (lastStrike ? 0.75 : 0.6) * s.match!.threshold && lead >= (lastStrike ? 300 : 200);
      target = sorted[0].id;
    } else {
      const ranked = others.map((p) => ({ id: p.id, s: this.suspicion[p.id] ?? 0 })).sort((a, b) => b.s - a.s);
      fire = ranked[0].s >= (lastStrike ? 4 : 3) && ranked[0].s - (ranked[1]?.s ?? 0) >= (lastStrike ? 1.5 : 1);
      target = ranked[0].id;
    }
    if (fire && this.social() < (lastStrike ? 0.2 : 0.35)) {
      // ACCUSE arms at the end of the reveal show; people react 1–4s later.
      const armed = Math.max(0, (s.match?.reveal?.accuseAt ?? Date.now()) - Date.now());
      setTimeout(() => this.send({ kind: "burnToken", targetPlayerId: target }), armed + 1000 + this.social() * 3000);
    }
  }

  private planVote(s: PublicState): void {
    const me = this.me();
    if (!me || me.banished || !me.votingRights) return;
    // v0.23: ballots open once the accused has had the floor.
    const open = Math.max(0, (s.match?.vote?.opensAt ?? Date.now()) - Date.now());
    if (isCircle(this.sc.policy)) {
      // Everyone votes for whoever is next in line. The person on the spot
      // knows their own role and votes for the next one instead; the cheater
      // happily helps send innocents to detention.
      const order = this.circleOrder(s);
      if (order.length < 2) return;
      const target = order[0] === this.playerId ? order[1] : order[0];
      setTimeout(() => this.send({ kind: "castVote", targetPlayerId: target }), open + 1500 + this.social() * 3000);
      return;
    }
    const others = this.suspects(s);
    if (!others.length) return;
    let target: string;
    if (this.sc.policy === "evidence") {
      const ranked = others.map((p) => ({ id: p.id, s: (this.suspicion[p.id] ?? 0) + p.score / 10000 })).sort((a, b) => b.s - a.s);
      target = ranked[0].id; // the cheater deflects onto the most-suspected innocent
    } else {
      target = [...others].sort((a, b) => b.score - a.score)[0].id;
    }
    setTimeout(() => this.send({ kind: "castVote", targetPlayerId: target }), open + 1500 + this.social() * 8000);
  }
}

// ---------------- Question source ----------------

function simSource(rngFor: (match: number) => () => number): { source: QuestionSource; current: () => Question[] } {
  let match = 0;
  let qs: Question[] = [];
  let rng = rngFor(0);
  return {
    current: () => qs,
    source: {
      prefetch() {},
      // v0.26: one question at a time, at the tier the class earned.
      start(asked = []) {
        if (!asked.length) rng = rngFor(match++);
        qs = [...asked];
      },
      next(tier) {
        const q: Question = {
          text: `Q${qs.length + 1}`,
          options: ["A", "B", "C", "D"],
          correctIdx: Math.floor(rng() * 4) as Question["correctIdx"],
          tier,
          subject: "Sim",
          subjectEmoji: "🧪",
          source: "local" as const,
        };
        qs.push(q);
        return q;
      },
    },
  };
}

/** Real question text from the bundled pack (fixtures look like real games). */
function localPackSource(): { source: QuestionSource; current: () => Question[] } {
  let qs: Question[] = [];
  resetLocalDeck();
  return {
    current: () => qs,
    source: {
      prefetch() {},
      start(asked = []) {
        localOnlySource.start(asked);
        qs = [...asked];
      },
      next(tier) {
        const q = localOnlySource.next(tier);
        qs.push(q);
        return q;
      },
    },
  };
}

// ---------------- Rule variants (sim only) ----------------

/** Wraps one engine instance so it plays by a variant rule set. The shipped
 *  rules are untouched; this only exists to test proposed changes. */
function applyRules(engine: HostEngine, rules: RuleVariant): void {
  const e = engine as unknown as {
    qIdx: number;
    phase: string;
    onBurnToken(player: unknown, targetId: unknown): void;
  };
  let votedInQ = -1;
  const burn = e.onBurnToken.bind(e);
  e.onBurnToken = (player, targetId) => {
    if (e.qIdx < (rules.accuseFromQ ?? 0)) return;
    if (rules.onePerReveal && votedInQ === e.qIdx) return;
    burn(player, targetId);
    if (e.phase === "vote") votedInQ = e.qIdx;
  };
}

// ---------------- Runner ----------------

export interface TapeFrame {
  t: number;
  state: PublicState;
}
export interface TapeSecret {
  t: number;
  playerId: string;
  secret: SecretState;
}

export interface MatchRecord {
  scenario: string;
  matchIndex: number;
  seed: number;
  events: MatchEvent[];
  tape?: { frames: TapeFrame[]; secrets: TapeSecret[]; players: { id: string; name: string }[] };
}

export interface RunResult {
  records: MatchRecord[];
  integrity: Integrity;
}

export async function runScenario(sc: Scenario, clock: VirtualClock): Promise<RunResult> {
  const human = sc.human ?? DEFAULT_HUMAN;
  const integrity: Integrity = { cheaterSecretMismatches: 0, innocentSecretLeaks: 0 };
  const records: MatchRecord[] = [];

  for (let mi = 0; mi < sc.matches; mi++) {
    const matchSeed = hashSeed(sc.seed, mi);
    clock.reset();
    // Engine randomness (cheater seat, ids) — independent of the player models
    // so the same seed gives the same cheater seat across strategies/policies.
    Math.random = mulberry32(hashSeed(matchSeed, "engine"));
    const qs = sc.questionSource === "local" ? localPackSource() : simSource(() => mulberry32(hashSeed(matchSeed, "questions")));
    const distractors: number[][] = [];
    const dRng = mulberry32(hashSeed(matchSeed, "distractors"));
    for (let q = 0; q < 10; q++) {
      distractors.push([0, 1, 2, 3].map(() => Math.pow(-Math.log(Math.max(dRng(), 1e-9)), 1 / human.distractorAlpha)));
    }
    const iRng = mulberry32(hashSeed(matchSeed, "intensity"));
    const intensity = Array.from({ length: 10 }, () => normal(iRng) * human.itemIntensitySd);
    const oracle: Oracle = {
      correctIdx: (q) => qs.current()[q].correctIdx,
      distractorWeights: (q) => distractors[q],
      itemIntensity: (q) => intensity[q],
    };

    const events: MatchEvent[] = [];
    const log = createEventLogger((e) => events.push(e));
    const phones = new Map<string, SimPhone>();
    let engine!: HostEngine;
    let ended = false;
    const frames: TapeFrame[] = [];
    const secrets: TapeSecret[] = [];

    const recordSecret = (phone: SimPhone | undefined, event: string, payload: unknown) => {
      if (!sc.record || !phone) return;
      if (event === "secret") secrets.push({ t: Date.now(), playerId: phone.playerId, secret: structuredClone((payload as { secret: SecretState }).secret) });
      if (event === "joined") {
        const j = payload as { playerId: string; secret: SecretState };
        secrets.push({ t: Date.now(), playerId: j.playerId, secret: structuredClone(j.secret) });
      }
    };
    const deliver = (phone: SimPhone | undefined, event: string, payload: unknown) => {
      phone?.receive(event, structuredClone(payload));
      recordSecret(phone, event, payload);
    };
    const transport: Transport = {
      toAll: (event, payload) => {
        for (const p of phones.values()) if (!p.isHost) deliver(p, event, payload);
      },
      toPlayer: (socketId, event, payload) => deliver(phones.get(socketId), event, payload),
      local: (event, payload) => {
        deliver(phones.get("local"), event, payload);
        if (event === "state") {
          const st = (payload as { state: PublicState }).state;
          log(st, Date.now());
          if (sc.record) frames.push({ t: Date.now(), state: structuredClone(st) });
          if (st.phase === "matchEnd") ended = true;
        }
      },
    };

    const mkPhone = (socketId: string, isHost: boolean, idx: number) =>
      new SimPhone(
        socketId,
        isHost,
        sc,
        human,
        oracle,
        (intent) => {
          if (isHost) engine.localIntent(intent);
          else setTimeout(() => engine.handleIntent(socketId, intent), 40); // ~network hop
        },
        () => engine.advance(),
        integrity,
        hashSeed(matchSeed, "answers", idx, sc.accuracy),
        hashSeed(matchSeed, "social", idx, sc.accuracy, sc.strategy, sc.policy),
      );

    const host = mkPhone("local", true, 0);
    phones.set("local", host);
    engine = new HostEngine("SIMXX", sc.names?.[0] ?? "Host", AVATARS[0], transport, qs.source);
    if (sc.rules) applyRules(engine, sc.rules);
    host.playerId = engine.hostPlayer.id;
    host.receive("state", { state: engine.publicState() });

    if (sc.mode === "builtinBots") {
      for (let i = 1; i < sc.players; i++) engine.addBot();
    } else {
      for (let i = 1; i < sc.players; i++) {
        const sid = `sock${i}`;
        phones.set(sid, mkPhone(sid, false, i));
        engine.handleJoinRequest(sid, sc.names?.[i] ?? `P${i}`, AVATARS[i % AVATARS.length]);
      }
    }

    if (sc.threshold) engine.updateSettings({ threshold: sc.threshold });
    if (sc.strikes !== undefined) engine.updateSettings({ strikes: sc.strikes });
    void engine.startMatch();
    await clock.runUntil(() => ended);
    // Engine ids carry a process-wide counter; rename them to seats so the
    // same seed always yields a byte-identical log.
    let text = JSON.stringify(events);
    engine.players.forEach((p, i) => {
      text = text.split(`"${p.id}"`).join(`"s${i}"`);
    });
    records.push({
      scenario: sc.name,
      matchIndex: mi,
      seed: matchSeed,
      events: JSON.parse(text),
      tape: sc.record ? { frames, secrets, players: engine.players.map((p) => ({ id: p.id, name: p.name })) } : undefined,
    });
  }
  return { records, integrity };
}
