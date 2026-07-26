// Host-authoritative game engine (specs 01–04). Runs ONLY in the host's
// browser. Receives validated intents, mutates state, broadcasts snapshots.
// Known accepted limitation (spec 00): the host can inspect this state.
import {
  AVATARS,
  DEFAULT_SETTINGS,
  MAX_PLAYERS,
  MIN_PLAYERS,
  QUESTIONS_PER_MATCH,
  SESSION_POINTS,
  type Intent,
  type MatchEndReason,
  type Phase,
  type PublicPlayer,
  type PublicState,
  type Question,
  type RevealRow,
  type SecretState,
  type Settings,
} from "../../shared/protocol";
import { getMatchQuestions, prefetchNextMatch } from "./providers";

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
}

interface AnswerRecord {
  pick: number; // -1 = no answer
  timeMs: number;
}

export interface Transport {
  toAll(event: string, payload: unknown): void;
  toPlayer(socketId: string, event: string, payload: unknown): void;
  /** Deliver state/secret to the host's own UI (loopback). */
  local(event: string, payload: unknown): void;
}

let nextId = 1;
const genId = () => `p${nextId++}_${Math.random().toString(36).slice(2, 8)}`;

export class HostEngine {
  players: InternalPlayer[] = [];
  settings: Settings = structuredClone(DEFAULT_SETTINGS);
  sessionBoard: Record<string, number> = {};
  matchNumber = 0;
  phase: Phase = "lobby";

  private questions: Question[] = [];
  private cheaterId = "";
  private qIdx = 0;
  private threshold = 0;
  private usedFallback = false;
  private questionDeadline = 0;
  private answers: Record<string, AnswerRecord>[] = []; // per question: playerId -> record
  private reveal: { correctIdx: number; rows: RevealRow[]; minNextAt: number } | null = null;
  private vote: { accuserId: string; deadline: number; votes: Record<string, string> } | null = null;
  private voteResult: NonNullable<NonNullable<PublicState["match"]>["voteResult"]> | null = null;
  private end: NonNullable<NonNullable<PublicState["match"]>["end"]> | null = null;
  private matchDelta: Record<string, number> = {}; // session points earned this match
  private loadingQuestions = false;

  /** Bumped on every phase transition; stale timers check it and bail. */
  private epoch = 0;

  constructor(public roomCode: string, hostName: string, hostAvatar: string, private transport: Transport) {
    const host: InternalPlayer = this.newPlayer(hostName, hostAvatar, "local", true);
    this.players.push(host);
    this.sessionBoard[host.id] = 0;
    prefetchNextMatch(); // warm the first match while people join the lobby
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
    };
  }

  // ---------------- Joining (spec 05) ----------------

  handleJoinRequest(socketId: string, rawName: string, avatar = ""): void {
    const name = rawName.trim().slice(0, 20);
    if (!name) {
      this.transport.toPlayer(socketId, "joinRejected", { reason: "Pick a name first." });
      return;
    }
    const existing = this.players.find((p) => p.name.toLowerCase() === name.toLowerCase());
    if (existing) {
      if (existing.connected) {
        // Duplicate names rejected with a friendly error (spec 05).
        this.transport.toPlayer(socketId, "joinRejected", { reason: `"${existing.name}" is already in this room. Pick another name.` });
        return;
      }
      // Rejoin: same name restores the seat and current state (spec 05).
      existing.socketId = socketId;
      existing.connected = true;
      if (avatar) existing.avatar = avatar;
      this.transport.toPlayer(socketId, "joined", {
        playerId: existing.id,
        state: this.publicState(),
        secret: this.secretFor(existing.id),
      });
      this.broadcast();
      return;
    }
    if (this.phase !== "lobby" && this.phase !== "matchEnd" && this.phase !== "sessionEnd") {
      this.transport.toPlayer(socketId, "joinRejected", { reason: "A match is in progress — join between matches." });
      return;
    }
    if (this.players.length >= MAX_PLAYERS) {
      this.transport.toPlayer(socketId, "joinRejected", { reason: `Room is full (${MAX_PLAYERS} players max).` });
      return;
    }
    const player = this.newPlayer(name, avatar, socketId, false);
    this.players.push(player);
    this.sessionBoard[player.id] = 0;
    this.transport.toPlayer(socketId, "joined", {
      playerId: player.id,
      state: this.publicState(),
      secret: this.secretFor(player.id),
    });
    this.broadcast();
  }

  handlePeerDisconnected(socketId: string): void {
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
      case "requestFullState":
        this.sendSnapshotTo(player);
        break;
    }
  }

  private sendSnapshotTo(player: InternalPlayer): void {
    const state = this.publicState();
    const secret = this.secretFor(player.id);
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
    if (this.phase !== "lobby" && this.phase !== "matchEnd") return;
    if (this.players.length >= MAX_PLAYERS) return;
    const name = HostEngine.BOT_NAMES.find((n) => !this.players.some((p) => p.name === n));
    if (!name) return;
    const avatar = AVATARS.find((a) => !this.players.some((p) => p.avatar === a)) ?? "";
    const bot = this.newPlayer(name, avatar, "bot", false);
    this.players.push(bot);
    this.sessionBoard[bot.id] = 0;
    this.broadcast();
  }

  removeBot(botId: string): void {
    if (this.phase !== "lobby" && this.phase !== "matchEnd") return;
    const idx = this.players.findIndex((p) => p.id === botId && p.isBot);
    if (idx === -1) return;
    delete this.sessionBoard[botId];
    this.players.splice(idx, 1);
    this.broadcast();
  }

  private bots(): InternalPlayer[] {
    return this.players.filter((p) => p.isBot);
  }

  /** Bots answer with tier-scaled accuracy; a bot cheater "reads the marker". */
  private botAnswer(botId: string): void {
    if (this.phase !== "question") return;
    const bot = this.players.find((p) => p.id === botId);
    if (!bot || bot.answeredCurrent) return;
    const q = this.questions[this.qIdx];
    const accuracy = bot.id === this.cheaterId ? 0.88 : { easy: 0.65, medium: 0.45, hard: 0.28 }[q.tier];
    let pick: number;
    if (Math.random() < accuracy) pick = q.correctIdx;
    else {
      const wrong = [0, 1, 2, 3].filter((i) => i !== q.correctIdx);
      pick = wrong[Math.floor(Math.random() * wrong.length)];
    }
    const elapsed = this.settings.questionTimerMs - (this.questionDeadline - Date.now());
    this.onAnswer(bot, this.qIdx, pick, elapsed);
  }

  private botVote(botId: string): void {
    if (this.phase !== "vote") return;
    const bot = this.players.find((p) => p.id === botId);
    if (!bot || bot.votedCurrent || !bot.votingRights || bot.banished) return;
    const candidates = this.players.filter((p) => !p.banished && p.id !== bot.id);
    if (!candidates.length) return;
    let target: InternalPlayer;
    if (bot.id === this.cheaterId) {
      // The bot cheater deflects onto a random innocent.
      target = candidates[Math.floor(Math.random() * candidates.length)];
    } else if (Math.random() < 0.4) {
      // Suspicion falls on the top scorer, like it does in real playgroups.
      target = candidates.reduce((a, b) => (b.score > a.score ? b : a));
    } else {
      target = candidates[Math.floor(Math.random() * candidates.length)];
    }
    this.onCastVote(bot, target.id);
  }

  /** During reveals, a bot occasionally burns its token on the top scorer —
   *  likelier once the cheater is closing in on graduation. */
  private scheduleBotAccusations(): void {
    const cheater = this.players.find((p) => p.id === this.cheaterId);
    const heat = cheater && this.threshold > 0 ? cheater.score / this.threshold : 0;
    const prob = heat >= 0.6 ? 0.2 : 0.05;
    const eligible = this.bots().filter((b) => !b.tokenUsed && !b.banished && b.votingRights);
    for (const bot of eligible) {
      if (Math.random() < prob) {
        this.after(2500 + Math.random() * 4000, () => this.onBurnToken(this.players.find((p) => p.id === bot.id)!));
        break; // at most one bot accusation per reveal
      }
    }
  }

  // ---------------- Host controls ----------------

  updateSettings(patch: Partial<Settings>): void {
    if (this.phase !== "lobby") return;
    this.settings = { ...this.settings, ...patch, tierPoints: { ...this.settings.tierPoints, ...(patch.tierPoints ?? {}) } };
    this.broadcast();
  }

  async startMatch(): Promise<void> {
    if (this.phase !== "lobby" && this.phase !== "matchEnd") return;
    const present = this.players.filter((p) => p.connected);
    if (present.length < MIN_PLAYERS || this.loadingQuestions) return;

    this.loadingQuestions = true;
    this.broadcast(); // lets the lobby show a brief "loading questions" state
    const batch = await getMatchQuestions();
    this.loadingQuestions = false;
    prefetchNextMatch(); // background-fetch the NEXT match during this one

    this.questions = batch.questions;
    this.usedFallback = batch.usedFallback;
    this.matchNumber++;
    this.qIdx = 0;
    this.threshold = this.settings.threshold;
    this.answers = Array.from({ length: QUESTIONS_PER_MATCH }, () => ({}));
    this.reveal = null;
    this.vote = null;
    this.voteResult = null;
    this.end = null;
    this.matchDelta = {};
    for (const p of this.players) {
      p.score = 0;
      p.tokenUsed = false;
      p.banished = false;
      p.votingRights = true;
      p.answeredCurrent = false;
      p.votedCurrent = false;
    }
    // Cheater: uniform random among players present at match start (spec 02).
    this.cheaterId = present[Math.floor(Math.random() * present.length)].id;

    this.setPhase("role");
    this.broadcast();
    this.sendSecrets();
    this.after(3000, () => this.startQuestion(0));
  }

  /** Context-sensitive host "Next": reveal → next question / Q10 end,
   *  voteResult → resolution, matchEnd → lobby. */
  advance(): void {
    if (this.phase === "reveal" && this.reveal && Date.now() >= this.reveal.minNextAt) {
      if (this.qIdx >= QUESTIONS_PER_MATCH - 1) this.endMatch("top_score");
      else this.startQuestion(this.qIdx + 1);
    } else if (this.phase === "voteResult") {
      this.afterVoteResult();
    } else if (this.phase === "matchEnd") {
      this.setPhase("lobby");
      this.broadcast();
    }
  }

  endSession(): void {
    if (this.phase !== "lobby" && this.phase !== "matchEnd") return;
    this.setPhase("sessionEnd");
    this.broadcast();
  }

  // ---------------- Question phase (spec 01) ----------------

  private startQuestion(idx: number): void {
    this.qIdx = idx;
    this.reveal = null;
    this.voteResult = null;
    for (const p of this.players) p.answeredCurrent = false;
    this.questionDeadline = Date.now() + this.settings.questionTimerMs;
    this.setPhase("question");
    this.broadcast();
    this.sendSecrets(); // cheater's copy carries correctIdx for this question
    this.after(this.settings.questionTimerMs + 400, () => this.endQuestion());
    for (const bot of this.bots()) {
      const delay = 1800 + Math.random() * this.settings.questionTimerMs * 0.55;
      this.after(delay, () => this.botAnswer(bot.id));
    }
  }

  private onAnswer(player: InternalPlayer, questionIdx: number, optionIdx: number, clientElapsedMs: number): void {
    if (this.phase !== "question" || questionIdx !== this.qIdx) return;
    if (player.answeredCurrent) return; // answers lock on first tap
    if (!Number.isInteger(optionIdx) || optionIdx < 0 || optionIdx > 3) return;
    const timeMs = Math.max(0, Math.min(this.settings.questionTimerMs, Math.round(clientElapsedMs)));
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

    // Threshold check fires the moment scores update (specs 01/02):
    // instant, loud takeover — the reveal never renders.
    const cheater = this.players.find((p) => p.id === this.cheaterId)!;
    if (cheater.score >= this.threshold) {
      this.endMatch("cheater_threshold");
      return;
    }

    this.reveal = { correctIdx: q.correctIdx, rows, minNextAt: Date.now() + this.settings.revealMinMs };
    this.setPhase("reveal");
    this.broadcast();
    this.sendSecrets(); // clears the cheater marker outside questions
    this.scheduleBotAccusations();
  }

  // ---------------- Accusations & voting (spec 03) ----------------

  private onBurnToken(player: InternalPlayer): void {
    // Only during reveal; near-simultaneous second tap arrives when phase is
    // already "vote" and is simply not consumed (spec 03).
    if (this.phase !== "reveal") return;
    if (player.tokenUsed || player.banished || !player.votingRights) return;
    player.tokenUsed = true;
    for (const p of this.players) p.votedCurrent = false;
    this.vote = { accuserId: player.id, deadline: Date.now() + this.settings.voteWindowMs, votes: {} };
    this.setPhase("vote");
    this.broadcast();
    this.after(this.settings.voteWindowMs + 400, () => this.resolveVote());
    for (const bot of this.bots()) {
      this.after(1500 + Math.random() * 6000, () => this.botVote(bot.id));
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
    // Threshold may have dropped to/below the cheater's public score —
    // the win check invariant (spec 02) fires here.
    const cheater = this.players.find((p) => p.id === this.cheaterId)!;
    if (this.voteResult.banishedId && cheater.score >= this.threshold) {
      this.endMatch("cheater_threshold");
      return;
    }
    // Back to the same reveal; the min-time gate has long passed.
    this.voteResult = null;
    this.setPhase("reveal");
    this.broadcast();
  }

  // ---------------- Match end & session (spec 04) ----------------

  private endMatch(reason: MatchEndReason): void {
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
    this.end = { reason, cheaterId: this.cheaterId, winnerIds, sessionDelta: { ...this.matchDelta } };
    this.setPhase("matchEnd");
    this.broadcast();
    this.sendSecrets();
  }

  private addSessionPoints(playerId: string, pts: number): void {
    this.sessionBoard[playerId] = (this.sessionBoard[playerId] ?? 0) + pts;
    this.matchDelta[playerId] = (this.matchDelta[playerId] ?? 0) + pts;
  }

  // ---------------- State & transport ----------------

  private setPhase(phase: Phase): void {
    this.phase = phase;
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
    }));
    const inMatch = this.phase !== "lobby" && this.phase !== "sessionEnd" && this.matchNumber > 0;
    const q = this.questions[this.qIdx];
    return {
      phase: this.phase,
      roomCode: this.roomCode,
      players,
      settings: this.settings,
      sessionBoard: { ...this.sessionBoard },
      matchNumber: this.matchNumber,
      offlineQuestions: this.usedFallback,
      match: inMatch
        ? {
            questionIdx: this.qIdx,
            questionCount: QUESTIONS_PER_MATCH,
            threshold: this.threshold,
            question:
              this.phase === "question" || this.phase === "reveal" || this.phase === "vote" || this.phase === "voteResult"
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
            vote: this.vote ? { accuserId: this.vote.accuserId, deadline: this.vote.deadline } : null,
            voteResult: this.voteResult,
            end: this.end,
          }
        : null,
      loadingQuestions: this.loadingQuestions,
    };
  }

  private secretFor(playerId: string): SecretState {
    const isCheater = playerId === this.cheaterId && this.matchNumber > 0 && this.phase !== "lobby" && this.phase !== "sessionEnd";
    return {
      isCheater,
      // Correct answer shown to the cheater the moment the question appears
      // (spec 02); -1 in every other copy — identical payload shape (spec 05).
      correctIdx: isCheater && this.phase === "question" ? this.questions[this.qIdx].correctIdx : -1,
    };
  }

  private broadcast(): void {
    const state = this.publicState();
    this.transport.toAll("state", { state });
    this.transport.local("state", { state });
  }

  /** Private per-socket role/answer delivery — sent to every player with an
   *  identical shape so traffic analysis is unhelpful (spec 05). */
  private sendSecrets(): void {
    for (const p of this.players) {
      if (p.isBot) continue; // bots "read" their marker inside botAnswer
      const secret = this.secretFor(p.id);
      if (p.socketId === "local") this.transport.local("secret", { secret });
      else if (p.socketId) this.transport.toPlayer(p.socketId, "secret", { secret });
    }
  }
}
