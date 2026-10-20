// Host-authoritative game engine (specs 01–04). Runs ONLY in the host's
// browser. Receives validated intents, mutates state, broadcasts snapshots.
// Known accepted limitation (spec 00): the host can inspect this state.
//
// Time: every timestamp in public state is on the SHARED clock (the relay
// server's, see clock.ts) so all phones play reveal beats together. The beat
// timelines themselves come from shared/choreo.ts and depend on public data
// only, so the cheater's screen runs exactly the same show as everyone else's.
import {
  lastBellIds,
  matchEndTimeline,
  revealStakes,
  revealTimeline,
  ROLE_SCREEN_MS,
  ROLE_SCREEN_TV_MS,
  TALK_HOLD_MS,
  voteResultTimeline,
} from "../../shared/choreo";
import { DEFAULT_EVIDENCE, EvidenceTracker, type CalloutKind, type EvidenceSave } from "../../shared/evidence";
import { DEFAULT_HUMAN, normal, sampleAnswer } from "../../shared/humanModel";
import {
  AVATARS,
  DEFAULT_SETTINGS,
  MAX_PLAYERS,
  MAX_SCREENS,
  MIN_PLAYERS,
  QUESTIONS_PER_MATCH,
  SESSION_POINTS,
  TIER_PLAN,
  type Award,
  type CaseEntry,
  type Intent,
  type MatchEndReason,
  type Phase,
  type PublicPlayer,
  type PracticeRole,
  type PublicState,
  type Question,
  type RevealRow,
  type SecretState,
  type Settings,
} from "../../shared/protocol";
import { openTdbSource, type QuestionSource } from "./providers";

interface InternalPlayer {
  id: string;
  name: string;
  avatar: string;
  socketId: string | null; // null while disconnected; "local" = host, "bot" = bot
  connected: boolean;
  isHost: boolean;
  isBot: boolean;
  score: number;
  tokenUsed: boolean;
  banished: boolean;
  votingRights: boolean;
  answeredCurrent: boolean;
  votedCurrent: boolean;
  // Bot personality (research-based human model; see shared/humanModel.ts).
  ability: number;
  speed: number;
  /** Seat token: only the phone holding it may take this seat over mid-match. */
  token: string;
  /** v0.5: whom this player points at (public, free, not a vote). */
  pointingAt: string | null;
  pointedAt: number; // last change, for the flood guard
}

interface AnswerRecord {
  pick: number; // -1 = no answer
  timeMs: number;
}

type RevealState = NonNullable<NonNullable<PublicState["match"]>["reveal"]>;

/** v0.14: the engine as plain JSON, saved by the host's page on every change
 *  so a reload (or a tab the browser threw away) can carry on. Timers aren't
 *  saved: restore() re-arms them from the phase and its deadlines. */
export interface EngineSnapshot {
  v: 1;
  roomCode: string;
  fields: Record<string, unknown>;
  evidence: EvidenceSave;
}

/** Every field that changes during a session (the rest are per page: the
 *  clock, the transport, timer epochs, the in-flight question fetch). */
const SAVED_FIELDS = [
  "players",
  "settings",
  "sessionBoard",
  "matchNumber",
  "phase",
  "phaseStartedAt",
  "questions",
  "cheaterId",
  "botCheaterCareful",
  "qIdx",
  "threshold",
  "wrongDetentions",
  "roleMs",
  "hallway",
  "usedFallback",
  "questionDeadline",
  "answers",
  "voteLog",
  "peakPointers",
  "firstPointAtCheater",
  "sessionStats",
  "dayAwards",
  "reveal",
  "revealMinFrom",
  "caseFile",
  "vote",
  "voteResult",
  "end",
  "matchDelta",
  "forceCheaterName", // the local test hook survives a reload too
] as const;

export interface Transport {
  toAll(event: string, payload: unknown): void;
  toPlayer(socketId: string, event: string, payload: unknown): void;
  /** Deliver state/secret to the host's own UI (loopback). */
  local(event: string, payload: unknown): void;
}

export interface EngineOptions {
  /** Shared-clock time source (host passes serverNow). Defaults to Date.now. */
  now?: () => number;
  /** Debug/test only: make the player with this name the cheater (flagged
   *  publicly via debugForcedCheater so nobody is fooled). */
  forceCheaterName?: string;
  /** Phases start this far in the FUTURE on the shared clock, so the state
   *  reaches every phone before beat 0 and all phones hit it together. */
  beatLeadMs?: number;
}

/** Covers a typical one-way relay delay (Wi-Fi tens of ms, cellular 100–200). */
export const BEAT_LEAD_MS = 250;

let nextId = 1;
const genId = () => `p${nextId++}_${Math.random().toString(36).slice(2, 8)}`;
const genToken = () => Array.from({ length: 4 }, () => Math.random().toString(36).slice(2, 8)).join("");

/** Phases in which a secret may say "you are the cheater". */
const SECRET_PHASES = new Set<Phase>(["role", "question", "reveal", "vote", "voteResult"]);
/** When pointing is open (v0.5), and the minimum gap between changes. */
const POINT_PHASES = new Set<Phase>(["question", "reveal", "vote", "voteResult"]);
const POINT_GUARD_MS = 350;
/** Every secret serializes to exactly this many characters. */
const SECRET_JSON_LEN = 56;

/** Bot accusation temperament, tuned in the simulator (sim/run.ts builtin)
 *  so a room of bots catches a bot cheater about half the time. */
export const BOT_TUNING = { lineHeat: 1, accuseAt: 2, minLead: 0.5, accuseChance: 0.4 };

/** v0.11: who may be dealt the cheater. A practice room (everyone besides the
 *  host is a bot) honours the host's chosen role — there's nobody to deceive.
 *  Any other room: everyone present, uniformly (spec 02). */
export function cheaterPool<P extends { isHost: boolean; isBot: boolean }>(present: P[], role: PracticeRole): P[] {
  const practice = present.length > 1 && present.every((p) => p.isHost || p.isBot);
  if (!practice || role === "random") return present;
  const pool = role === "cheater" ? present.filter((p) => p.isHost) : present.filter((p) => !p.isHost);
  return pool.length ? pool : present;
}

/** How much each announced callout raises a bot's suspicion of its subject. */
const SUSPICION: Partial<Record<CalloutKind, number>> = {
  lone_correct: 2,
  hard_sweep: 2,
  against_crowd: 1.5,
  lightning: 1.5,
  streak: 1,
  near_line: 1,
};

export class HostEngine {
  players: InternalPlayer[] = [];
  settings: Settings = structuredClone(DEFAULT_SETTINGS);
  sessionBoard: Record<string, number> = {};
  matchNumber = 0;
  phase: Phase = "lobby";

  private now: () => number;
  private lead: number;
  private forceCheaterName?: string;
  private botEpoch = 0; // invalidates scheduled bot accusations (host skip)
  private phaseStartedAt = 0;
  private questions: Question[] = [];
  private cheaterId = "";
  private botCheaterCareful = false;
  private qIdx = 0;
  private threshold = 0;
  private wrongDetentions = 0; // strikes this match (settings.strikes ends it)
  private roleMs = ROLE_SCREEN_MS; // v0.19: longer with a big screen (its host opens the period)
  /** v0.7: late arrivals watching this period; seated back in homeroom. */
  private hallway: InternalPlayer[] = [];
  /** v0.16: sockets of big screens (TV, laptop). Never players, never saved:
   *  a screen asks again when the host's phone comes back. */
  private watchers = new Set<string>();
  private pointBroadcastAt = 0; // pointer changes share broadcasts (v0.11)
  private pointBroadcastPending = false;
  private stopped = false; // v0.18: this page no longer hosts (see stop())
  private usedFallback = false;
  private questionDeadline = 0;
  private answers: Record<string, AnswerRecord>[] = []; // per question: playerId -> record
  // v0.8 superlatives: every vote this match, and the most 👉 anyone drew at once.
  private voteLog: { q: number; votes: Record<string, string>; banishedId: string | null }[] = [];
  private peakPointers: Record<string, number> = {};
  private firstPointAtCheater: Record<string, number> = {}; // playerId -> question index
  /** v0.8: across the session, for the day's yearbook. */
  private sessionStats: Record<string, { awards: number; cheaterVotes: number; cheaterWins: number; detentions: number }> = {};
  private dayAwards: Award[] = [];
  private reveal: RevealState | null = null;
  private revealMinFrom = 0; // original reveal start (spec 01 minimum counts from here)
  private evidence = new EvidenceTracker(DEFAULT_EVIDENCE);
  private caseFile: CaseEntry[] = [];
  private vote: { accuserId: string; deadline: number; votes: Record<string, string> } | null = null;
  private voteResult: NonNullable<NonNullable<PublicState["match"]>["voteResult"]> | null = null;
  private end: NonNullable<NonNullable<PublicState["match"]>["end"]> | null = null;
  private matchDelta: Record<string, number> = {}; // session points earned this match
  private loadingQuestions = false;

  /** Bumped on every phase transition; stale timers check it and bail. */
  private epoch = 0;

  constructor(
    public roomCode: string,
    hostName: string,
    hostAvatar: string,
    private transport: Transport,
    private source: QuestionSource = openTdbSource,
    options: EngineOptions = {},
  ) {
    this.now = options.now ?? (() => Date.now());
    this.lead = options.beatLeadMs ?? BEAT_LEAD_MS;
    this.forceCheaterName = options.forceCheaterName;
    this.phaseStartedAt = this.now();
    const host: InternalPlayer = this.newPlayer(hostName, hostAvatar, "local", true);
    this.players.push(host);
    this.sessionBoard[host.id] = 0;
    this.source.prefetch(); // warm the first match while people join the lobby
  }

  get hostPlayer(): InternalPlayer {
    return this.players.find((p) => p.isHost)!;
  }

  private newPlayer(name: string, avatar: string, socketId: string, isHost: boolean): InternalPlayer {
    return {
      id: genId(),
      name,
      avatar: avatar || AVATARS[Math.floor(Math.random() * AVATARS.length)],
      socketId,
      connected: true,
      isHost,
      isBot: socketId === "bot",
      score: 0,
      tokenUsed: false,
      banished: false,
      votingRights: true,
      answeredCurrent: false,
      votedCurrent: false,
      ability: normal(Math.random) * DEFAULT_HUMAN.abilitySd,
      speed: normal(Math.random) * DEFAULT_HUMAN.speedSd,
      token: socketId === "bot" ? "" : genToken(),
      pointingAt: null,
      pointedAt: 0,
    };
  }

  // ---------------- Joining (spec 05) ----------------

  handleJoinRequest(socketId: string, rawName: string, avatar = "", token = "", watch = false): void {
    // v0.16: a big screen watches the show. Not a player, not in the
    // hallway, never the cheater: it only ever gets the public state.
    if (watch) {
      if (!this.watchers.has(socketId) && this.watchers.size >= MAX_SCREENS) {
        this.transport.toPlayer(socketId, "joinRejected", { reason: `This classroom already has ${MAX_SCREENS} big screens.` });
        return;
      }
      this.watchers.add(socketId);
      this.transport.toPlayer(socketId, "joined", { playerId: "", state: this.publicState(), secret: this.paddedSecret(""), token: "" });
      this.broadcast();
      return;
    }
    const name = rawName.trim().slice(0, 20);
    if (!name) {
      this.transport.toPlayer(socketId, "joinRejected", { reason: "Pick a name first." });
      return;
    }
    const existing = this.players.find((p) => p.name.toLowerCase() === name.toLowerCase());
    if (existing) {
      const owner = !!token && !existing.isBot && token === existing.token;
      const between = this.phase === "lobby" || this.phase === "matchEnd";
      // Rejoin (spec 05). The seat's own phone (token) may always take it back
      // — even before the relay notices its old socket died. A bare name may
      // only reclaim an EMPTY seat between matches: mid-match that would hand
      // a stranger the seat's secret.
      if (!owner && (existing.connected || existing.isBot)) {
        this.transport.toPlayer(socketId, "joinRejected", { reason: `"${existing.name}" is already in this room. Pick another name.` });
        return;
      }
      if (!owner && !between) {
        this.transport.toPlayer(socketId, "joinRejected", { reason: `"${existing.name}" is mid-match — rejoin from the phone that was playing, or wait for the report card.` });
        return;
      }
      existing.socketId = socketId;
      existing.connected = true;
      if (avatar) existing.avatar = avatar;
      this.transport.toPlayer(socketId, "joined", {
        playerId: existing.id,
        state: this.publicState(),
        secret: this.paddedSecret(existing.id),
        token: existing.token,
      });
      this.broadcast();
      return;
    }
    // The hallway (v0.7): mid-period (or while the quiz prints) a newcomer
    // watches this period and takes a seat at the next one, instead of being
    // turned away.
    const midPeriod = (this.phase !== "lobby" && this.phase !== "matchEnd") || this.loadingQuestions;
    const waitingByName = this.hallway.find((h) => h.name.toLowerCase() === name.toLowerCase());
    if (midPeriod || waitingByName) {
      const waiting = waitingByName;
      if (waiting && waiting.connected && !(token && token === waiting.token)) {
        this.transport.toPlayer(socketId, "joinRejected", { reason: `"${waiting.name}" is already in the hallway. Pick another name.` });
        return;
      }
      if (!waiting && this.players.length + this.hallway.length >= MAX_PLAYERS) {
        this.transport.toPlayer(socketId, "joinRejected", { reason: `Room is full (${MAX_PLAYERS} players max).` });
        return;
      }
      const h = waiting ?? this.newPlayer(name, avatar, socketId, false);
      if (waiting) {
        waiting.socketId = socketId;
        waiting.connected = true;
        if (avatar) waiting.avatar = avatar;
      } else this.hallway.push(h);
      this.transport.toPlayer(socketId, "joined", { playerId: h.id, state: this.publicState(), secret: this.paddedSecret(h.id), token: h.token });
      this.broadcast();
      return;
    }
    if (this.players.length + this.hallway.length >= MAX_PLAYERS) {
      this.transport.toPlayer(socketId, "joinRejected", { reason: `Room is full (${MAX_PLAYERS} players max).` });
      return;
    }
    const player = this.newPlayer(name, avatar, socketId, false);
    this.players.push(player);
    this.sessionBoard[player.id] = 0;
    this.transport.toPlayer(socketId, "joined", {
      playerId: player.id,
      state: this.publicState(),
      secret: this.paddedSecret(player.id),
      token: player.token,
    });
    this.broadcast();
  }

  handlePeerDisconnected(socketId: string): void {
    if (this.watchers.delete(socketId)) {
      this.broadcast();
      return;
    }
    // Someone in the hallway dropped out: keep their place (connected=false)
    // so the same phone coming back keeps the same id; seatHallway() only
    // seats people who are here.
    const waiting = this.hallway.find((h) => h.socketId === socketId);
    if (waiting) {
      waiting.connected = false;
      waiting.socketId = null;
      this.broadcast();
      return;
    }
    const player = this.players.find((p) => p.socketId === socketId);
    if (!player) return;
    player.connected = false;
    player.socketId = null;
    // Timers never wait for a disconnected player (spec 05) — if everyone
    // else already answered/voted, resolve now.
    if (this.phase === "question") this.maybeEndQuestionEarly();
    if (this.phase === "vote") this.maybeResolveVoteEarly();
    this.broadcast();
  }

  // ---------------- Intents ----------------

  handleIntent(socketId: string, intent: Intent): void {
    const player = this.players.find((p) => p.socketId === socketId);
    if (!player) return;
    this.dispatch(player, intent);
  }

  /** Host player's own actions arrive here directly (no network hop). */
  localIntent(intent: Intent): void {
    this.dispatch(this.hostPlayer, intent);
  }

  private dispatch(player: InternalPlayer, intent: Intent): void {
    switch (intent.kind) {
      case "answer":
        this.onAnswer(player, intent.questionIdx, intent.optionIdx, intent.clientElapsedMs);
        break;
      case "burnToken":
        this.onBurnToken(player);
        break;
      case "castVote":
        this.onCastVote(player, intent.targetPlayerId);
        break;
      case "point":
        this.onPoint(player, intent.targetPlayerId);
        break;
      case "requestFullState":
        this.sendSnapshotTo(player);
        break;
    }
  }

  private sendSnapshotTo(player: InternalPlayer): void {
    const state = this.publicState();
    const secret = this.paddedSecret(player.id);
    if (player.socketId === "local") {
      this.transport.local("state", { state });
      this.transport.local("secret", { secret });
    } else if (player.socketId) {
      this.transport.toPlayer(player.socketId, "state", { state });
      this.transport.toPlayer(player.socketId, "secret", { secret });
    }
  }

  // ---------------- Bots ----------------

  private static readonly BOT_NAMES = [
    "Sleepy Sam", "Class Clown Cal", "Bookworm Bea", "Hall Monitor Hank",
    "Gum-Chewer Gwen", "Overachiever Omar", "Doodler Dee", "Late-Pass Lou", "Recess Rex",
  ];

  addBot(): void {
    if ((this.phase !== "lobby" && this.phase !== "matchEnd") || this.loadingQuestions) return;
    if (this.players.length + this.hallway.length >= MAX_PLAYERS) return;
    const name = HostEngine.BOT_NAMES.find((n) => !this.players.some((p) => p.name === n));
    if (!name) return;
    const avatar = AVATARS.find((a) => !this.players.some((p) => p.avatar === a)) ?? "";
    const bot = this.newPlayer(name, avatar, "bot", false);
    this.players.push(bot);
    this.sessionBoard[bot.id] = 0;
    this.broadcast();
  }

  removeBot(botId: string): void {
    this.removePlayer(botId);
  }

  /** Between periods the host can clear a bot's seat, or the seat of a
   *  classmate who left for good (disconnected) — never someone still here. */
  removePlayer(id: string): void {
    if ((this.phase !== "lobby" && this.phase !== "matchEnd") || this.loadingQuestions) return;
    const idx = this.players.findIndex((p) => p.id === id && !p.isHost && (p.isBot || !p.connected));
    if (idx === -1) return;
    delete this.sessionBoard[id];
    this.players.splice(idx, 1);
    this.broadcast();
  }

  /** v0.10: the same class starts a new day — fresh standings, same room,
   *  same code, nobody has to rejoin. */
  newDay(): void {
    if (this.phase !== "sessionEnd") return;
    for (const p of this.players) {
      this.sessionBoard[p.id] = 0;
      p.score = 0;
    }
    this.sessionStats = {};
    this.dayAwards = [];
    this.matchNumber = 0;
    this.end = null;
    this.seatHallway();
    this.clearPeriodFlags();
    this.setPhase("lobby");
    this.broadcast();
  }

  /** Back in homeroom nobody is still "in detention" from last period, and
   *  everyone's accusation and pointer are fresh (they used to linger until
   *  the next bell, showing stale DETENTION badges in the lobby). */
  private clearPeriodFlags(): void {
    for (const p of this.players) {
      p.banished = false;
      p.tokenUsed = false;
      p.votingRights = true;
      p.answeredCurrent = false;
      p.votedCurrent = false;
      p.pointingAt = null;
    }
  }

  private bots(): InternalPlayer[] {
    return this.players.filter((p) => p.isBot);
  }

  /** Bots answer like the simulated humans: knowledge and speed from the
   *  research-based model. A bot cheater plays either "mimic" (always right,
   *  human timing) or "careful" (sandbags some easy/medium questions). */
  private planBotAnswer(bot: InternalPlayer, elapsed = 0): void {
    const q = this.questions[this.qIdx];
    const isCheater = bot.id === this.cheaterId;
    const a = sampleAnswer(Math.random, DEFAULT_HUMAN, "mid", q.tier, bot.ability, bot.speed);
    let pick: number;
    let rt = a.rtMs;
    const wrong = () => {
      const opts = [0, 1, 2, 3].filter((i) => i !== q.correctIdx);
      return opts[Math.floor(Math.random() * opts.length)];
    };
    if (isCheater) {
      const sandbag = this.botCheaterCareful && q.tier !== "hard" && Math.random() < (q.tier === "easy" ? 0.15 : 0.3);
      pick = sandbag ? wrong() : q.correctIdx;
      const h = DEFAULT_HUMAN;
      const shifted = (median: number, sigma: number) => h.shiftMs + (median - h.shiftMs) * Math.exp(sigma * normal(Math.random) + bot.speed);
      // Right answers at a knower's pace; a deliberate miss at a guesser's
      // pace (a fast wrong answer would itself be a tell).
      if (sandbag) rt = shifted(h.guessMedianMs[q.tier], h.guessSigma);
      else if (!a.knows) rt = shifted(h.knowMedianMs[q.tier], h.knowSigma);
    } else {
      pick = a.knows || a.guessRight ? q.correctIdx : wrong();
    }
    const timer = this.settings.questionTimerMs;
    if (rt >= timer - 250) {
      if (Math.random() > DEFAULT_HUMAN.lastSecondTap) return; // ran out of time
      rt = timer - 1500 + Math.random() * 1400;
    }
    // Restored mid-question (v0.14): a bot that would have answered by now answers soon.
    if (rt <= elapsed) rt = Math.min(timer - 250, elapsed + 300 + Math.random() * 1200);
    this.after(Math.max(0, rt - elapsed), () => {
      if (this.phase !== "question" || bot.answeredCurrent) return;
      this.onAnswer(bot, this.qIdx, pick, rt);
    });
  }

  /** Public-evidence suspicion, the way a sharp player would keep score:
   *  announced callouts, plus pressure from closing in on the line. */
  private suspicionOf(id: string): number {
    let s = 0;
    for (const e of this.caseFile) if (e.subjectIds.includes(id)) s += SUSPICION[e.kind as CalloutKind] ?? 0;
    const p = this.players.find((x) => x.id === id);
    if (p && this.threshold > 0) {
      const share = p.score / this.threshold;
      if (share >= 0.6) s += BOT_TUNING.lineHeat;
      if (share >= 0.8) s += BOT_TUNING.lineHeat;
    }
    return s;
  }

  private suspects(excludeId: string): InternalPlayer[] {
    return this.players.filter((p) => p.id !== excludeId && !p.banished && !this.evidence.cleared.has(p.id));
  }

  /** After the show arms ACCUSE, a bot with a clear suspect may raise its
   *  hand. Never before the accuse beat — the reveal is never interrupted.
   *  The cheater bot plays by the SAME rule (bluffing at its top suspect):
   *  a hidden role must never gate a public action, or every accusing bot
   *  would be provably innocent. */
  private scheduleBotAccusations(): void {
    if (!this.reveal) return;
    const wait = Math.max(0, this.reveal.accuseAt - this.now());
    const epoch = ++this.botEpoch;
    for (const bot of this.bots()) {
      if (bot.tokenUsed || bot.banished || !bot.votingRights) continue;
      const ranked = this.suspects(bot.id)
        .map((p) => ({ p, s: this.suspicionOf(p.id) }))
        .sort((a, b) => b.s - a.s);
      if (!ranked.length) continue;
      const lead = ranked[0].s - (ranked[1]?.s ?? 0);
      // On the last strike a wrong detention ends the match: be surer.
      const lastStrike = this.settings.strikes > 0 && this.wrongDetentions === this.settings.strikes - 1;
      const need = BOT_TUNING.accuseAt + (lastStrike ? 1 : 0);
      if (ranked[0].s >= need && lead >= BOT_TUNING.minLead && Math.random() < BOT_TUNING.accuseChance * (lastStrike ? 0.5 : 1)) {
        this.after(wait + 1200 + Math.random() * 3500, () => {
          if (epoch !== this.botEpoch) return; // superseded (host skipped the show)
          const fresh = this.players.find((p) => p.id === bot.id);
          if (fresh) this.onBurnToken(fresh);
        });
        return; // at most one bot accusation per reveal
      }
    }
  }

  private botVote(bot: InternalPlayer): void {
    if (this.phase !== "vote" || bot.votedCurrent || !bot.votingRights || bot.banished) return;
    const candidates = this.suspects(bot.id);
    if (!candidates.length) return;
    // Highest suspicion, ties to the higher score. A bot cheater deflects onto
    // the most suspicious innocent the same way.
    const target = candidates.reduce((a, b) => {
      const sa = this.suspicionOf(a.id) + a.score / 10000;
      const sb = this.suspicionOf(b.id) + b.score / 10000;
      return sb > sa ? b : a;
    });
    this.onCastVote(bot, target.id);
  }

  // ---------------- Host controls ----------------

  updateSettings(patch: Partial<Settings>): void {
    if (this.phase !== "lobby" || this.loadingQuestions) return;
    this.settings = { ...this.settings, ...patch, tierPoints: { ...this.settings.tierPoints, ...(patch.tierPoints ?? {}) } };
    this.broadcast();
  }

  /** Late arrivals take their seats once the class is between periods. */
  private seatHallway(): void {
    const ready = this.hallway.filter((h) => h.connected);
    this.hallway = [];
    for (const h of ready) {
      this.players.push(h);
      this.sessionBoard[h.id] = 0;
    }
  }

  async startMatch(): Promise<void> {
    if (this.phase !== "lobby" && this.phase !== "matchEnd") return;
    this.seatHallway(); // starting straight from the report card
    const present = this.players.filter((p) => p.connected);
    if (present.length < MIN_PLAYERS || this.loadingQuestions) return;

    this.loadingQuestions = true;
    this.broadcast(); // lets the lobby show a brief "loading questions" state
    const batch = await this.source.get();
    this.loadingQuestions = false;
    this.source.prefetch(); // background-fetch the NEXT match during this one
    // The room may have changed during the wait (up to ~8s): re-check it.
    const ready = this.players.filter((p) => p.connected);
    if ((this.phase !== "lobby" && this.phase !== "matchEnd") || ready.length < MIN_PLAYERS) {
      // The start fell through: anyone who arrived while the quiz printed
      // takes their seat now instead of waiting in an empty hallway.
      if (this.phase === "lobby" || this.phase === "matchEnd") this.seatHallway();
      this.broadcast();
      return;
    }
    present.splice(0, present.length, ...ready);

    this.questions = batch.questions;
    this.usedFallback = batch.usedFallback;
    this.matchNumber++;
    this.qIdx = 0;
    this.threshold = this.settings.threshold;
    this.wrongDetentions = 0;
    this.answers = Array.from({ length: QUESTIONS_PER_MATCH }, () => ({}));
    this.reveal = null;
    this.vote = null;
    this.voteResult = null;
    this.end = null;
    this.matchDelta = {};
    this.evidence = new EvidenceTracker(DEFAULT_EVIDENCE);
    this.caseFile = [];
    this.voteLog = [];
    this.peakPointers = {};
    this.firstPointAtCheater = {};
    for (const p of this.players) {
      p.score = 0;
      p.tokenUsed = false;
      p.banished = false;
      p.votingRights = true;
      p.answeredCurrent = false;
      p.votedCurrent = false;
      p.pointingAt = null;
    }
    // Cheater: uniform random among players present at match start (spec 02).
    const forced = this.forceCheaterName && present.find((p) => p.name.toLowerCase() === this.forceCheaterName!.toLowerCase());
    const pool = cheaterPool(present, this.settings.practiceRole);
    this.cheaterId = (forced || pool[Math.floor(Math.random() * pool.length)]).id;
    this.botCheaterCareful = Math.random() < 0.5;
    // A seat that wasn't connected at the bell cannot be the cheater. Say so
    // publicly, so nobody gains a private elimination from noticing it.
    const absent = this.players.filter((p) => !p.connected).map((p) => p.id);
    if (absent.length) {
      for (const id of absent) this.evidence.cleared.add(id);
      this.caseFile.push({ q: -1, tier: "easy", kind: "cleared", subjectIds: absent, detail: { absent: 1 } });
    }

    this.setPhase("role");
    this.broadcast();
    this.sendSecrets();
    this.roleMs = this.watchers.size ? ROLE_SCREEN_TV_MS : ROLE_SCREEN_MS;
    this.after(this.roleMs, () => this.startQuestion(0));
  }

  /** Context-sensitive host "Next": reveal → next question / Q10 end,
   *  voteResult → resolution, matchEnd → lobby. Each waits for its show. */
  advance(): void {
    const now = this.now();
    if (this.phase === "reveal" && this.reveal && now >= this.reveal.minNextAt) {
      if (this.qIdx >= QUESTIONS_PER_MATCH - 1) this.endMatch("top_score");
      else this.startQuestion(this.qIdx + 1);
    } else if (this.phase === "voteResult" && this.voteResult) {
      const tl = voteResultTimeline(Object.keys(this.voteResult.votes).length, this.voteResult.newThreshold !== null);
      if (now >= this.phaseStartedAt + tl.end) this.afterVoteResult();
    } else if (this.phase === "matchEnd" && this.end) {
      if (now >= this.phaseStartedAt + matchEndTimeline(this.end.reason).end) {
        this.seatHallway();
        this.clearPeriodFlags();
        this.setPhase("lobby");
        this.broadcast();
      }
    }
  }

  /** Host skips the reveal show to the accuse beat. The jump is scheduled a
   *  beat-lead into the future so every phone lands it together. */
  skipShow(): void {
    if (this.phase !== "reveal" || !this.reveal) return;
    const target = this.now() + this.lead;
    if (target >= this.reveal.accuseAt) return;
    const delta = this.reveal.accuseAt - target;
    this.reveal.startedAt -= delta;
    this.reveal.accuseAt = target;
    this.reveal.minNextAt = Math.max(this.revealMinFrom + this.settings.revealMinMs, target + TALK_HOLD_MS);
    this.phaseStartedAt -= delta;
    this.broadcast();
    this.scheduleBotAccusations(); // re-rolls once; the earlier roll is invalidated
    this.scheduleBotPointers();
  }

  endSession(): void {
    if ((this.phase !== "lobby" && this.phase !== "matchEnd") || this.loadingQuestions) return;
    this.dayAwards = this.computeDayAwards();
    this.setPhase("sessionEnd");
    this.broadcast();
  }

  // ---------------- Question phase (spec 01) ----------------

  private startQuestion(idx: number): void {
    this.qIdx = idx;
    this.reveal = null;
    this.voteResult = null;
    for (const p of this.players) p.answeredCurrent = false;
    this.setPhase("question");
    this.questionDeadline = this.phaseStartedAt + this.settings.questionTimerMs;
    this.broadcast();
    this.sendSecrets(); // cheater's copy carries correctIdx for this question
    this.after(this.settings.questionTimerMs + 400, () => this.endQuestion());
    for (const bot of this.bots()) this.planBotAnswer(bot);
  }

  private onAnswer(player: InternalPlayer, questionIdx: number, optionIdx: number, clientElapsedMs: number): void {
    if (this.phase !== "question" || questionIdx !== this.qIdx) return;
    if (player.answeredCurrent) return; // answers lock on first tap
    if (!Number.isInteger(optionIdx) || optionIdx < 0 || optionIdx > 3) return;
    const elapsed = Number.isFinite(clientElapsedMs) ? clientElapsedMs : this.settings.questionTimerMs;
    const timeMs = Math.max(0, Math.min(this.settings.questionTimerMs, Math.round(elapsed)));
    this.answers[this.qIdx][player.id] = { pick: optionIdx, timeMs };
    player.answeredCurrent = true;
    this.broadcast();
    this.maybeEndQuestionEarly();
  }

  private maybeEndQuestionEarly(): void {
    if (this.phase !== "question") return;
    const waitingFor = this.players.filter((p) => p.connected && !p.answeredCurrent);
    if (waitingFor.length === 0) this.endQuestion();
  }

  private endQuestion(): void {
    if (this.phase !== "question") return;
    const q = this.questions[this.qIdx];
    const points = this.settings.tierPoints[q.tier];
    const rows: RevealRow[] = this.players.map((p) => {
      const rec = this.answers[this.qIdx][p.id] ?? { pick: -1, timeMs: 0 };
      const correct = rec.pick === q.correctIdx;
      if (correct) p.score += points; // banished innocents keep scoring (spec 03)
      return { playerId: p.id, pick: rec.pick, correct, timeMs: rec.timeMs, pointsGained: correct ? points : 0 };
    });
    // Beat 0 of the show sits a lead into the future (see BEAT_LEAD_MS).
    const now = this.now() + this.lead;
    const base = { correctIdx: q.correctIdx, rows, startedAt: now, stakes: "high" as const, callout: null, lastBell: [] as string[], accuseAt: now, minNextAt: now };

    // Threshold check fires the moment scores update (specs 01/02): instant,
    // loud takeover. The winning question's reveal still rides along in the
    // matchEnd state so the end screen can show the answer that did it.
    const cheater = this.players.find((p) => p.id === this.cheaterId);
    if (cheater && cheater.score >= this.threshold) {
      this.reveal = base;
      this.endMatch("cheater_threshold");
      return;
    }

    // Evidence from public data only — identical on every phone.
    const scores = Object.fromEntries(this.players.map((p) => [p.id, p.score]));
    const activeIds = this.players.filter((p) => !p.banished).map((p) => p.id);
    const res = this.evidence.add({ questionIdx: this.qIdx, tier: q.tier, rows, scores, threshold: this.threshold, activeIds });
    const callout: CaseEntry | null = res.selected
      ? { q: this.qIdx, tier: q.tier, kind: res.selected.kind, subjectIds: res.selected.subjectIds, detail: res.selected.detail }
      : null;
    if (callout) this.caseFile.push(callout);
    const suspectIds = activeIds.filter((id) => !this.evidence.cleared.has(id));
    const nextTier = TIER_PLAN[this.qIdx + 1];
    const lastBell = lastBellIds(scores, suspectIds, this.threshold, nextTier ? this.settings.tierPoints[nextTier] : null);
    const stakes = revealStakes(q.tier, res.selected, lastBell.length > 0);
    const tl = revealTimeline(stakes, rows.length, !!callout);
    const accuseAt = now + tl.beats.accuse;
    this.revealMinFrom = now;
    this.reveal = {
      ...base,
      stakes,
      callout,
      lastBell,
      accuseAt,
      minNextAt: Math.max(now + this.settings.revealMinMs, accuseAt + TALK_HOLD_MS),
    };

    this.setPhase("reveal");
    this.phaseStartedAt = now;
    this.broadcast();
    this.sendSecrets(); // clears the cheater marker outside questions
    this.scheduleBotAccusations();
    this.scheduleBotPointers();
  }

  // ---------------- Pointing (v0.5) ----------------

  /** Point at a suspect (or stop, with null). Free, public, changeable, and
   *  not a vote: it lets the class see who suspects whom before anyone
   *  spends an accusation. Anyone in the match may point, detention included. */
  private onPoint(player: InternalPlayer, targetId: string | null): void {
    if (!POINT_PHASES.has(this.phase)) return;
    const now = this.now();
    const target = targetId ? this.players.find((p) => p.id === targetId) : null;
    if (targetId && (!target || target.id === player.id || target.banished)) return;
    const next = target ? target.id : null;
    if (player.pointingAt === next) return;
    player.pointingAt = next;
    if (next) {
      const n = this.players.filter((p) => p.pointingAt === next).length;
      this.peakPointers[next] = Math.max(this.peakPointers[next] ?? 0, n);
      if (next === this.cheaterId && this.firstPointAtCheater[player.id] === undefined) this.firstPointAtCheater[player.id] = this.qIdx;
    }
    player.pointedAt = now;
    // Every change counts (the latest wins); a flurry of them shares one
    // broadcast per POINT_GUARD_MS instead of flooding every phone.
    if (now - this.pointBroadcastAt >= POINT_GUARD_MS) {
      this.pointBroadcastAt = now;
      this.broadcast();
    } else if (!this.pointBroadcastPending) {
      this.pointBroadcastPending = true;
      setTimeout(() => {
        this.pointBroadcastPending = false;
        this.pointBroadcastAt = this.now();
        this.broadcast();
      }, POINT_GUARD_MS);
    }
  }

  /** Bots point at their top suspect once the board is graded (the cheater
   *  bot bluffs the same way), so a solo test room has a live pointer board. */
  private scheduleBotPointers(): void {
    if (!this.reveal) return;
    const wait = Math.max(0, this.reveal.accuseAt - this.now());
    const epoch = this.botEpoch;
    for (const bot of this.bots()) {
      const ranked = this.suspects(bot.id)
        .map((p) => ({ p, s: this.suspicionOf(p.id) }))
        .sort((a, b) => b.s - a.s);
      const top = ranked[0];
      if (!top || top.s < 1 || bot.pointingAt === top.p.id) continue;
      this.after(wait + 300 + Math.random() * 2500, () => {
        if (epoch !== this.botEpoch) return;
        const fresh = this.players.find((p) => p.id === bot.id);
        if (fresh) this.onPoint(fresh, top.p.id);
      });
    }
  }

  // ---------------- Accusations & voting (spec 03) ----------------

  private onBurnToken(player: InternalPlayer): void {
    // Only during reveal, and only once the show has armed ACCUSE; a
    // near-simultaneous second tap arrives when the phase is already "vote"
    // and is simply not consumed (spec 03).
    if (this.phase !== "reveal" || !this.reveal) return;
    if (this.now() < this.reveal.accuseAt) return;
    if (player.tokenUsed || player.banished || !player.votingRights) return;
    player.tokenUsed = true;
    for (const p of this.players) p.votedCurrent = false;
    this.setPhase("vote");
    this.vote = { accuserId: player.id, deadline: this.phaseStartedAt + this.settings.voteWindowMs, votes: {} };
    this.broadcast();
    this.after(this.settings.voteWindowMs + 400, () => this.resolveVote());
    for (const bot of this.bots()) {
      this.after(1500 + Math.random() * 6000, () => this.botVote(bot));
    }
  }

  private onCastVote(player: InternalPlayer, targetPlayerId: string): void {
    if (this.phase !== "vote" || !this.vote) return;
    if (!player.votingRights || player.banished || player.votedCurrent) return;
    const target = this.players.find((p) => p.id === targetPlayerId);
    if (!target || target.banished) return;
    this.vote.votes[player.id] = target.id;
    player.votedCurrent = true;
    this.broadcast();
    this.maybeResolveVoteEarly();
  }

  private maybeResolveVoteEarly(): void {
    if (this.phase !== "vote") return;
    const pending = this.players.filter((p) => p.connected && p.votingRights && !p.banished && !p.votedCurrent);
    if (pending.length === 0) this.resolveVote();
  }

  private resolveVote(): void {
    if (this.phase !== "vote" || !this.vote) return;
    const { accuserId, votes } = this.vote;
    const tallies: Record<string, number> = {};
    for (const target of Object.values(votes)) tallies[target] = (tallies[target] ?? 0) + 1;

    let banishedId: string | null = null;
    let tie = false;
    const max = Math.max(0, ...Object.values(tallies));
    const top = Object.keys(tallies).filter((id) => tallies[id] === max);
    if (max === 0 || top.length !== 1) {
      // Tie or abstain-only: nobody banished, token stays burned, no drop.
      tie = true;
    } else {
      banishedId = top[0];
    }

    const wasCheater = banishedId === this.cheaterId;
    let newThreshold: number | null = null;

    if (banishedId && !wasCheater) {
      const banished = this.players.find((p) => p.id === banishedId)!;
      banished.banished = true;
      banished.votingRights = false; // keeps answering & scoring, loses vote/accuse rights
      this.threshold -= this.settings.thresholdDrop; // loud public drop (spec 02)
      this.wrongDetentions++;
      for (const p of this.players) if (p.pointingAt === banishedId) p.pointingAt = null; // they're out
      newThreshold = this.threshold;
      for (const [voterId, targetId] of Object.entries(votes)) {
        if (targetId === banishedId) this.addSessionPoints(voterId, SESSION_POINTS.votedToBanishInnocent);
      }
    }
    if (wasCheater && banishedId) {
      for (const [voterId, targetId] of Object.entries(votes)) {
        if (targetId === banishedId) this.addSessionPoints(voterId, SESSION_POINTS.votedForCheaterInBanishingVote);
      }
      this.addSessionPoints(accuserId, SESSION_POINTS.triggeredBanishingVote);
    }

    this.voteResult = { accuserId, votes, tallies, banishedId, wasCheater, newThreshold, tie };
    this.voteLog.push({ q: this.qIdx, votes: { ...votes }, banishedId });
    this.vote = null;
    this.setPhase("voteResult");
    this.broadcast();
  }

  private afterVoteResult(): void {
    if (!this.voteResult) return;
    if (this.voteResult.wasCheater) {
      this.endMatch("cheater_banished");
      return;
    }
    // Strike out (v0.4): this many wrong detentions and the cheater graduates
    // on the spot, whatever the score.
    if (this.voteResult.banishedId && this.settings.strikes > 0 && this.wrongDetentions >= this.settings.strikes) {
      this.endMatch("cheater_threshold", true);
      return;
    }
    // Threshold may have dropped to/below the cheater's public score —
    // the win check invariant (spec 02) fires here.
    const cheater = this.players.find((p) => p.id === this.cheaterId);
    if (this.voteResult.banishedId && cheater && cheater.score >= this.threshold) {
      this.endMatch("cheater_threshold");
      return;
    }
    // The match continues, so the cheater is below the (possibly lowered)
    // line: anyone now at/above it is proven innocent right away.
    if (this.voteResult.newThreshold !== null && this.reveal) {
      const scores = Object.fromEntries(this.players.map((p) => [p.id, p.score]));
      const active = this.players.filter((p) => !p.banished).map((p) => p.id);
      const fresh = this.evidence.clearAtOrAbove(this.threshold, scores, active);
      if (fresh.length) {
        this.caseFile.push({ q: this.qIdx, tier: this.questions[this.qIdx].tier, kind: "cleared", subjectIds: fresh, detail: { threshold: this.threshold } });
      }
      const suspects = active.filter((id) => !this.evidence.cleared.has(id));
      const nextTier = TIER_PLAN[this.qIdx + 1];
      this.reveal.lastBell = lastBellIds(scores, suspects, this.threshold, nextTier ? this.settings.tierPoints[nextTier] : null);
    }
    // Back to the same reveal; its show has finished, so it renders settled.
    this.voteResult = null;
    this.setPhase("reveal");
    this.broadcast();
    this.scheduleBotAccusations();
    this.scheduleBotPointers();
  }

  // ---------------- Match end & session (spec 04) ----------------

  private endMatch(reason: MatchEndReason, struckOut = false): void {
    let winnerIds: string[] = [];
    if (reason === "cheater_banished") {
      winnerIds = this.players.filter((p) => p.id !== this.cheaterId).map((p) => p.id);
      // Vote-related session points were applied in resolveVote.
    } else if (reason === "cheater_threshold") {
      winnerIds = [this.cheaterId];
      this.addSessionPoints(this.cheaterId, SESSION_POINTS.cheaterHitThreshold);
    } else {
      // Q10: highest quiz scorer wins, role irrelevant; ties share (spec 04).
      const topScore = Math.max(...this.players.map((p) => p.score));
      winnerIds = this.players.filter((p) => p.score === topScore).map((p) => p.id);
      for (const id of winnerIds) this.addSessionPoints(id, SESSION_POINTS.topScoreAtQ10);
      this.addSessionPoints(this.cheaterId, SESSION_POINTS.cheaterSurvivedToQ10);
    }
    const awards = this.computeAwards(reason, struckOut, winnerIds);
    this.tallySession(awards, winnerIds);
    const tells = this.computeTells();
    this.end = { reason, ...(struckOut ? { struckOut: true } : {}), cheaterId: this.cheaterId, winnerIds, sessionDelta: { ...this.matchDelta }, awards, tells };
    this.setPhase("matchEnd");
    this.broadcast();
    this.sendSecrets();
  }

  /** v0.17: the cheater's record against the class's this period: right
   *  answers and median answer time. Published with the result (the cheater is
   *  unmasked by then), so everyone learns what to look for next time. */
  private computeTells(): { asked: number; cheater: { right: number; medianMs: number }; class: { right: number; medianMs: number } } {
    const asked = Math.min(this.qIdx + 1, this.questions.length);
    const median = (xs: number[]) => {
      if (!xs.length) return 0;
      const s = [...xs].sort((a, b) => a - b);
      const m = s.length >> 1;
      return Math.round(s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2);
    };
    const record = (ids: string[]) => {
      let right = 0;
      const times: number[] = [];
      for (let q = 0; q < asked; q++) {
        for (const id of ids) {
          const a = this.answers[q]?.[id];
          if (!a || a.pick < 0) continue;
          times.push(a.timeMs);
          if (a.pick === this.questions[q].correctIdx) right++;
        }
      }
      return { right, medianMs: median(times) };
    };
    // The class = innocents who answered at least once this period.
    const innocents = this.players
      .filter((p) => p.id !== this.cheaterId)
      .map((p) => p.id)
      .filter((id) => this.answers.slice(0, asked).some((a) => a[id]));
    const cls = record(innocents);
    return {
      asked,
      cheater: record([this.cheaterId]),
      class: { right: innocents.length ? Math.round((cls.right / innocents.length) * 10) / 10 : 0, medianMs: cls.medianMs },
    };
  }

  /** Yearbook superlatives (v0.8): one for the cheater, then the detective,
   *  the most-suspected innocent, and quiz awards — at most 4, one per player.
   *  Public data the host already holds; computed once, the same everywhere. */
  private computeAwards(reason: MatchEndReason, struckOut: boolean, winnerIds: string[]): Award[] {
    const out: Award[] = [];
    const used = new Set<string>();
    const give = (a: Award | null) => {
      if (a && !used.has(a.playerId) && out.length < 4) {
        out.push(a);
        used.add(a.playerId);
      }
    };
    const secs = (ms: number) => `${(ms / 1000).toFixed(1)}s`;
    const qn = this.qIdx + 1;
    const cheater = this.players.find((p) => p.id === this.cheaterId);
    const innocents = this.players.filter((p) => p.id !== this.cheaterId);

    // The cheater's own line in the yearbook.
    if (cheater) {
      if (reason === "cheater_banished") give({ icon: "🚨", title: "Caught red-handed", playerId: cheater.id, why: `Sent to the principal at Q${qn}` });
      else if (reason === "cheater_threshold")
        give(
          struckOut
            ? { icon: "🎭", title: "Let them dig", playerId: cheater.id, why: `Watched ${this.wrongDetentions} innocent${this.wrongDetentions === 1 ? "" : "s"} go to detention` }
            : { icon: "🎓", title: "Graduated early", playerId: cheater.id, why: `Crossed the line at Q${qn}` },
        );
      else give({ icon: "🎭", title: winnerIds.includes(cheater.id) ? "Master of disguise" : "Hid in plain sight", playerId: cheater.id, why: "Never caught" });
    }

    // Detective: the most votes for the cheater, then the earliest 👉 at them.
    const forCheater = (id: string) => this.voteLog.filter((v) => v.votes[id] === this.cheaterId).length;
    const detective = innocents
      .map((p) => ({ p, n: forCheater(p.id), first: this.firstPointAtCheater[p.id] ?? Infinity }))
      .filter((x) => x.n > 0 || x.first !== Infinity)
      .sort((a, b) => b.n - a.n || a.first - b.first)[0];
    if (detective)
      give({
        icon: "🕵️",
        title: "Detective",
        playerId: detective.p.id,
        why: detective.n > 0 ? `${detective.n} vote${detective.n === 1 ? "" : "s"} for the cheater` : `Pointed at the cheater from Q${detective.first + 1}`,
      });

    // The innocent who took the heat: sent to detention first, else most suspected.
    const firstWrong = this.voteLog.find((v) => v.banishedId && v.banishedId !== this.cheaterId);
    if (firstWrong?.banishedId) give({ icon: "😇", title: "Wrongly accused", playerId: firstWrong.banishedId, why: `Sent to detention at Q${firstWrong.q + 1}` });
    const votesAgainst = (id: string) => this.voteLog.reduce((n, v) => n + Object.values(v.votes).filter((t) => t === id).length, 0);
    const herring = innocents
      .map((p) => ({ p, heat: votesAgainst(p.id) + (this.peakPointers[p.id] ?? 0) }))
      .sort((a, b) => b.heat - a.heat)[0];
    if (herring && herring.heat >= 2)
      give({ icon: "🙈", title: "Red herring", playerId: herring.p.id, why: `${this.peakPointers[herring.p.id] ?? 0} 👉 at once, ${votesAgainst(herring.p.id)} votes` });

    // Quiz awards.
    const med = (xs: number[]) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : Infinity);
    const stats = this.players.map((p) => {
      const recs = this.answers
        .slice(0, this.qIdx + 1)
        .map((a, q) => ({ q, r: a[p.id] }))
        .filter((x) => x.r && x.r.pick >= 0);
      const right = recs.filter((x) => x.r!.pick === this.questions[x.q].correctIdx);
      return { p, answered: recs.length, right: right.length, rightMed: med(right.map((x) => x.r!.timeMs)), allMed: med(recs.map((x) => x.r!.timeMs)) };
    });
    const top = [...stats].filter((x) => x.right > 0).sort((a, b) => b.right - a.right || a.rightMed - b.rightMed)[0];
    if (top) give({ icon: "🧠", title: "Top marks", playerId: top.p.id, why: `${top.right} of ${this.qIdx + 1} right` });
    const fast = [...stats].filter((x) => x.right >= 3 && !used.has(x.p.id)).sort((a, b) => a.rightMed - b.rightMed)[0];
    if (fast) give({ icon: "⚡", title: "Fastest pencil", playerId: fast.p.id, why: `${secs(fast.rightMed)} per right answer` });
    const slow = [...stats].filter((x) => x.answered >= 3 && !used.has(x.p.id)).sort((a, b) => b.allMed - a.allMed)[0];
    if (slow) give({ icon: "🐢", title: "Last pencil down", playerId: slow.p.id, why: `${secs(slow.allMed)} per answer` });
    return out;
  }

  private statsOf(id: string) {
    return (this.sessionStats[id] ??= { awards: 0, cheaterVotes: 0, cheaterWins: 0, detentions: 0 });
  }

  /** Fold this period into the session tallies (for the day's yearbook). */
  private tallySession(awards: Award[], winnerIds: string[]): void {
    for (const a of awards) this.statsOf(a.playerId).awards++;
    for (const v of this.voteLog) {
      for (const [voter, target] of Object.entries(v.votes)) if (target === this.cheaterId) this.statsOf(voter).cheaterVotes++;
      if (v.banishedId && v.banishedId !== this.cheaterId) this.statsOf(v.banishedId).detentions++;
    }
    if (winnerIds.includes(this.cheaterId)) this.statsOf(this.cheaterId).cheaterWins++;
  }

  /** The day's yearbook (v0.8): at most 4, one per player, only for things
   *  that actually happened. */
  private computeDayAwards(): Award[] {
    type Key = "awards" | "cheaterVotes" | "cheaterWins" | "detentions";
    const out: Award[] = [];
    const used = new Set<string>();
    const best = (key: Key, min: number) =>
      this.players
        .map((p) => ({ p, n: this.sessionStats[p.id]?.[key] ?? 0 }))
        .filter((x) => x.n >= min && !used.has(x.p.id))
        .sort((a, b) => b.n - a.n)[0];
    const give = (x: { p: InternalPlayer; n: number } | undefined, icon: string, title: string, why: (n: number) => string) => {
      if (!x || out.length >= 4) return;
      out.push({ icon, title, playerId: x.p.id, why: why(x.n) });
      used.add(x.p.id);
    };
    const times = (n: number) => (n === 1 ? "once" : n === 2 ? "twice" : `${n} times`);
    give(best("cheaterWins", 1), "🎭", "Best actor", (n) => `Got away with it ${times(n)}`);
    give(best("cheaterVotes", 1), "🕵️", "Head detective", (n) => `${n} vote${n === 1 ? "" : "s"} for the cheater`);
    give(best("awards", 2), "🏅", "Most decorated", (n) => `${n} superlatives`);
    give(best("detentions", 1), "😇", "Most wrongly accused", (n) => `Sent to detention ${times(n)}`);
    return out;
  }

  private addSessionPoints(playerId: string, pts: number): void {
    this.sessionBoard[playerId] = (this.sessionBoard[playerId] ?? 0) + pts;
    this.matchDelta[playerId] = (this.matchDelta[playerId] ?? 0) + pts;
  }

  // ---------------- State & transport ----------------

  /** Phases start a beat-lead into the future on the shared clock, so the
   *  state reaches every phone before its beat 0 (sync across the room). */
  private setPhase(phase: Phase): void {
    this.phase = phase;
    this.phaseStartedAt = this.now() + this.lead;
    this.epoch++;
  }

  private after(ms: number, fn: () => void): void {
    const epochAtSchedule = this.epoch;
    setTimeout(() => {
      if (this.epoch === epochAtSchedule) fn();
    }, ms);
  }

  publicState(): PublicState {
    const players: PublicPlayer[] = this.players.map((p) => ({
      id: p.id,
      name: p.name,
      avatar: p.avatar,
      connected: p.connected,
      isHost: p.isHost,
      isBot: p.isBot,
      score: p.score,
      tokenUsed: p.tokenUsed,
      banished: p.banished,
      votingRights: p.votingRights,
      answeredCurrent: p.answeredCurrent,
      votedCurrent: p.votedCurrent,
      pointingAt: p.pointingAt,
    }));
    const inMatch = this.phase !== "lobby" && this.phase !== "sessionEnd" && this.matchNumber > 0;
    const q = this.questions[this.qIdx];
    const showQuestion = this.phase === "question" || this.phase === "reveal" || this.phase === "vote" || this.phase === "voteResult" || this.phase === "matchEnd";
    return {
      phase: this.phase,
      phaseStartedAt: this.phaseStartedAt,
      roomCode: this.roomCode,
      players,
      settings: this.settings,
      sessionBoard: { ...this.sessionBoard },
      dayAwards: this.phase === "sessionEnd" ? this.dayAwards : undefined,
      matchNumber: this.matchNumber,
      offlineQuestions: this.usedFallback,
      match: inMatch
        ? {
            questionIdx: this.qIdx,
            questionCount: QUESTIONS_PER_MATCH,
            threshold: this.threshold,
            wrongDetentions: this.wrongDetentions,
            question: showQuestion
              ? {
                  text: q.text,
                  options: [...q.options],
                  tier: q.tier,
                  subject: q.subject,
                  subjectEmoji: q.subjectEmoji,
                  points: this.settings.tierPoints[q.tier],
                  deadline: this.questionDeadline,
                }
              : null,
            reveal: this.phase === "question" ? null : this.reveal,
            caseFile: [...this.caseFile],
            cleared: [...this.evidence.cleared],
            vote: this.vote ? { accuserId: this.vote.accuserId, deadline: this.vote.deadline } : null,
            voteResult: this.voteResult,
            end: this.end,
          }
        : null,
      loadingQuestions: this.loadingQuestions,
      hallway: this.hallway.filter((h) => h.connected).map((h) => ({ id: h.id, name: h.name, avatar: h.avatar })),
      ...(this.watchers.size ? { screens: this.watchers.size } : {}),
      debugForcedCheater: !!this.forceCheaterName,
    };
  }

  /** Test hook: the serialized length of every phone's secret right now. */
  secretLengths(): number[] {
    return this.players.filter((p) => !p.isBot).map((p) => JSON.stringify(this.paddedSecret(p.id)).length);
  }

  private secretFor(playerId: string): SecretState {
    const isCheater = playerId === this.cheaterId && this.matchNumber > 0 && SECRET_PHASES.has(this.phase);
    return {
      isCheater,
      // Correct answer shown to the cheater the moment the question appears
      // (spec 02); -1 in every other copy — identical payload shape (spec 05).
      correctIdx: isCheater && this.phase === "question" ? this.questions[this.qIdx].correctIdx : -1,
    };
  }

  /** The secret as sent: padded so every copy (cheater or not, any phase)
   *  serializes to exactly SECRET_JSON_LEN characters on the wire. */
  private paddedSecret(playerId: string): SecretState {
    const s = this.secretFor(playerId);
    const bare = JSON.stringify({ ...s, _: "" }).length;
    return { ...s, _: " ".repeat(Math.max(0, SECRET_JSON_LEN - bare)) };
  }

  /** v0.14: everything restore() needs, as JSON-safe data (serialize it
   *  right away: it shares objects with the live engine). */
  snapshot(): EngineSnapshot {
    const self = this as unknown as Record<string, unknown>;
    const fields: Record<string, unknown> = {};
    for (const k of SAVED_FIELDS) fields[k] = self[k];
    return { v: 1, roomCode: this.roomCode, fields, evidence: this.evidence.save() };
  }

  /** v0.14: the host's page reloaded. Rebuild the engine from its last
   *  snapshot and re-arm whatever the phase was waiting for. */
  static restore(snap: EngineSnapshot, transport: Transport, source: QuestionSource = openTdbSource, options: EngineOptions = {}): HostEngine {
    const players = snap.fields.players as InternalPlayer[];
    const host = players.find((p) => p.isHost)!;
    const engine = new HostEngine(snap.roomCode, host.name, host.avatar, transport, source, options);
    Object.assign(engine as unknown as Record<string, unknown>, snap.fields);
    engine.evidence = EvidenceTracker.load(snap.evidence);
    engine.loadingQuestions = false; // a fetch in flight died with the page: Start again
    engine.rearm();
    return engine;
  }

  /** After restore(): the timers the current phase was waiting on. */
  private rearm(): void {
    const now = this.now();
    if (this.phase === "role") {
      this.after(Math.max(0, this.phaseStartedAt - this.lead + this.roleMs - now), () => this.startQuestion(0));
    } else if (this.phase === "question") {
      this.after(Math.max(0, this.questionDeadline - this.lead + 400 - now), () => this.endQuestion());
      const elapsed = Math.max(0, now - (this.questionDeadline - this.settings.questionTimerMs));
      for (const bot of this.bots()) if (!bot.answeredCurrent) this.planBotAnswer(bot, elapsed);
      this.maybeEndQuestionEarly();
    } else if (this.phase === "reveal") {
      this.scheduleBotAccusations();
      this.scheduleBotPointers();
    } else if (this.phase === "vote" && this.vote) {
      const left = this.vote.deadline - now;
      this.after(Math.max(0, left + 400), () => this.resolveVote());
      for (const bot of this.bots()) {
        if (!bot.votedCurrent) this.after(Math.max(0, Math.min(left - 600, 800 + Math.random() * 2500)), () => this.botVote(bot));
      }
      this.maybeResolveVoteEarly();
    }
    // voteResult, matchEnd, lobby, sessionEnd: they wait for the host's tap.
  }

  /** v0.18: this page no longer hosts (its room closed, or another tab took
   *  it over): every pending timer bails and nothing is sent or saved again. */
  stop(): void {
    this.stopped = true;
    this.epoch++;
    this.botEpoch++;
  }

  /** The host's phone is back after dropping out: everyone gets the current
   *  state and their own secret again (messages sent while away were lost). */
  resync(): void {
    this.broadcast();
    this.sendSecrets();
  }

  private broadcast(): void {
    if (this.stopped) return;
    const state = this.publicState();
    this.transport.toAll("state", { state });
    this.transport.local("state", { state });
  }

  /** Private per-socket role/answer delivery — sent to every player with an
   *  identical shape so traffic analysis is unhelpful (spec 05). */
  private sendSecrets(): void {
    if (this.stopped) return;
    for (const p of this.players) {
      if (p.isBot) continue; // bots read the engine directly
      const secret = this.paddedSecret(p.id);
      if (p.socketId === "local") this.transport.local("secret", { secret });
      else if (p.socketId) this.transport.toPlayer(p.socketId, "secret", { secret });
    }
  }
}
