// Shared protocol types — used by the relay server and both client roles.
// The server never inspects game payloads (dumb relay, spec 05); these types
// exist so the host engine and player UI agree on shapes.

export type Tier = "easy" | "medium" | "hard";

export interface Question {
  text: string;
  options: [string, string, string, string]; // pre-shuffled
  correctIdx: 0 | 1 | 2 | 3;
  tier: Tier;
  subject: string; // school subject, e.g. "Math"
  subjectEmoji: string; // e.g. "📐"
  source: "opentdb" | "local";
}

/** School subjects — each of a match's 10 questions gets a different one.
 *  `cat` is the OpenTDB category id. */
export const SUBJECTS = [
  { label: "Math", emoji: "📐", cat: 19 },
  { label: "Science", emoji: "🧪", cat: 17 },
  { label: "History", emoji: "🏛️", cat: 23 },
  { label: "Geography", emoji: "🗺️", cat: 22 },
  { label: "Art", emoji: "🎨", cat: 25 },
  { label: "Music", emoji: "🎵", cat: 12 },
  { label: "Literature", emoji: "📚", cat: 10 },
  { label: "Computer Class", emoji: "💻", cat: 18 },
  { label: "P.E.", emoji: "⚽", cat: 21 },
  { label: "Mythology", emoji: "🏺", cat: 20 },
  { label: "Civics", emoji: "🗳️", cat: 24 },
  { label: "Film Studies", emoji: "🎬", cat: 11 },
] as const;

export const AVATARS = ["🎒", "📚", "✏️", "🧪", "🔬", "📐", "🎨", "🎧", "⚽", "🍎", "🧮", "🗺️", "🖍️", "🏀", "🎺", "💻"];

export interface Settings {
  questionTimerMs: number; // default 15000
  revealMinMs: number; // default 8000
  voteWindowMs: number; // default 20000
  threshold: number; // default 2100 (v0.4; was 1400)
  thresholdDrop: number; // default 200
  /** The cheater graduates on this many wrong detentions, whatever their
   *  score (v0.4). 0 = off. Stops "send everyone in turn" from being free. */
  strikes: number; // default 2
  tierPoints: Record<Tier, number>; // 100 / 200 / 400
}

export const DEFAULT_SETTINGS: Settings = {
  questionTimerMs: 15000,
  revealMinMs: 8000,
  voteWindowMs: 20000,
  // v0.4: 2100 with two strikes puts a cheater who hides at 35–55% wins
  // (sim/tune-line.ts); 1400 let them win 81–97%.
  threshold: 2100,
  thresholdDrop: 200,
  strikes: 2,
  tierPoints: { easy: 100, medium: 200, hard: 400 },
};

// Session point values (spec 04 — proposed defaults, hardcoded in v1 but
// kept as a single table so a lobby-settings editor can slot in later).
export const SESSION_POINTS = {
  votedForCheaterInBanishingVote: 2,
  triggeredBanishingVote: 1,
  cheaterHitThreshold: 3,
  topScoreAtQ10: 2,
  cheaterSurvivedToQ10: 1,
  votedToBanishInnocent: -1,
} as const;

export type Phase =
  | "lobby"
  | "role"
  | "question"
  | "reveal"
  | "vote"
  | "voteResult"
  | "matchEnd"
  | "sessionEnd";

export type MatchEndReason = "cheater_banished" | "cheater_threshold" | "top_score";

export interface PublicPlayer {
  /** Whom this player is pointing at (v0.5): free, public, not a vote. */
  pointingAt: string | null;
  id: string;
  name: string;
  avatar: string; // school-themed emoji
  connected: boolean;
  isHost: boolean;
  isBot: boolean;
  // per-match
  score: number;
  tokenUsed: boolean;
  banished: boolean;
  votingRights: boolean;
  answeredCurrent: boolean;
  votedCurrent: boolean;
}

export interface RevealRow {
  playerId: string;
  pick: number; // -1 = no answer
  correct: boolean;
  timeMs: number;
  pointsGained: number;
}

/** A yearbook superlative (v0.8): computed once by the host at match end,
 *  the same for every phone. */
export interface Award {
  icon: string;
  title: string;
  playerId: string;
  why: string;
}

/** One announced piece of evidence, kept for the rest of the match. */
export interface CaseEntry {
  q: number; // question index it came from
  tier: Tier;
  kind: string; // CalloutKind (shared/evidence.ts)
  subjectIds: string[];
  detail: Record<string, number>;
}

export interface PublicState {
  phase: Phase;
  phaseStartedAt: number; // shared-clock ms when this phase began
  roomCode: string;
  players: PublicPlayer[];
  settings: Settings;
  sessionBoard: Record<string, number>; // playerId -> session points
  /** v0.8: the day's yearbook, at session end only. */
  dayAwards?: Award[];
  matchNumber: number; // 1-based, 0 = none played yet
  offlineQuestions: boolean; // fallback pack active this match (spec 06)
  loadingQuestions: boolean; // host is fetching questions at match start
  /** v0.7 the hallway: arrived mid-period, watching, seated at the next one. */
  hallway?: { id: string; name: string; avatar: string }[];
  debugForcedCheater?: boolean; // test hook active: the cheater is not random (shown to everyone)
  match: null | {
    questionIdx: number; // 0-based
    questionCount: number;
    threshold: number; // current (drops on wrong banishments)
    wrongDetentions: number; // innocents sent to detention this match (strikes)
    question: null | {
      text: string;
      options: string[];
      tier: Tier;
      subject: string;
      subjectEmoji: string;
      points: number;
      deadline: number; // host-issued epoch ms
    };
    reveal: null | {
      correctIdx: number;
      rows: RevealRow[];
      startedAt: number; // shared-clock ms: beat 0 of the reveal show
      stakes: "low" | "mid" | "high";
      callout: CaseEntry | null; // the one piece of evidence this reveal announces
      lastBell: string[]; // could graduate on the next question if they're the cheater
      accuseAt: number; // shared-clock ms when ACCUSE arms
      minNextAt: number; // shared-clock ms; host Next enabled after this
    };
    caseFile: CaseEntry[]; // every announced callout this match, in order
    cleared: string[]; // proven innocent: at/above the line with no siren
    vote: null | {
      accuserId: string;
      deadline: number;
    };
    voteResult: null | {
      accuserId: string;
      votes: Record<string, string>; // voterId -> targetId (revealed simultaneously)
      tallies: Record<string, number>; // targetId -> count
      banishedId: string | null;
      wasCheater: boolean;
      newThreshold: number | null; // set when an innocent was banished
      tie: boolean;
    };
    end: null | {
      reason: MatchEndReason;
      /** cheater_threshold reached by striking out (too many wrong detentions). */
      struckOut?: boolean;
      /** Yearbook superlatives (v0.8), at most 4, one per player. */
      awards?: Award[];
      cheaterId: string;
      winnerIds: string[];
      sessionDelta: Record<string, number>; // playerId -> points earned this match
    };
  };
}

/** Private per-socket payload. Sent to EVERY player with identical shape
 *  (padding, spec 05) — only the cheater's copy carries real data. */
export interface SecretState {
  isCheater: boolean;
  correctIdx: number; // real index for cheater during a question, -1 otherwise
  /** Padding so every copy serializes to the same byte length on the wire
   *  (spec 05: the cheater's packet must not be distinguishable by size). */
  _?: string;
}

// ---- Client -> host intents (relayed) ----
export type Intent =
  | { kind: "answer"; questionIdx: number; optionIdx: number; clientElapsedMs: number }
  | { kind: "burnToken" }
  | { kind: "castVote"; targetPlayerId: string }
  | { kind: "point"; targetPlayerId: string | null }
  | { kind: "requestFullState" };

// ---- Relay wire events (the only things the server understands) ----
// client -> server:  createRoom(cb) · join {code, name} · intent {payload}
// host   -> server:  toAll {event, payload} · toPlayer {socketId, event, payload}
// server -> host:    joinRequest {socketId, name} · intent {fromSocket, payload} · peerDisconnected {socketId}
// server -> client:  roomClosed
export interface JoinRequestMsg {
  socketId: string;
  name: string;
  avatar: string;
  token?: string;
}
export interface RelayedIntent {
  fromSocket: string;
  payload: Intent;
}

/** Events the host emits to players (via toAll / toPlayer). */
export interface StateEvent {
  state: PublicState;
}
export interface JoinedMsg {
  playerId: string;
  state: PublicState;
  secret: SecretState;
  /** Seat token: proves this phone owns the seat on a later rejoin. */
  token: string;
}
export interface JoinRejectedMsg {
  reason: string;
}

export const ROOM_CODE_LEN = 5;
export const MIN_PLAYERS = 3;
export const MAX_PLAYERS = 10;
export const QUESTIONS_PER_MATCH = 10;
export const TIER_PLAN: Tier[] = [
  "easy", "easy", "easy",
  "medium", "medium", "medium", "medium",
  "hard", "hard", "hard",
];
