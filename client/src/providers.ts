// Content pipeline (spec 06, school edition). v0.26: questions are drawn one
// at a time, at the tier the class has earned (protocol.ts nextTier), in a
// subject the period hasn't had yet. The curated local pack answers at once
// and, since v0.29, comes first; OpenTDB (host only, session token, ≥5s
// spacing) keeps a few questions of each tier ready in the background for
// when the pack has nothing new. Game logic only sees Question.
import type { Question, Tier } from "../../shared/protocol";
import { SUBJECTS } from "../../shared/protocol";
import { LOCAL_PACK, type RawQuestion } from "./localPack";
import { isSeen, markSeen } from "./seen";

type SubjectDef = (typeof SUBJECTS)[number];

const REQUEST_SPACING_MS = 5200; // OpenTDB: ~1 request / 5s per IP

function shuffle<T>(arr: readonly T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function decodeEntities(s: string): string {
  const el = document.createElement("textarea");
  el.innerHTML = s;
  return el.value;
}

/** Shared build step: shuffle options, record correctIdx post-shuffle. */
function buildQuestion(
  raw: { text: string; correct: string; incorrect: [string, string, string] },
  tier: Tier,
  subject: string,
  subjectEmoji: string,
  source: Question["source"],
): Question {
  const options = shuffle([raw.correct, ...raw.incorrect]);
  return {
    text: raw.text,
    options: options as Question["options"],
    correctIdx: options.indexOf(raw.correct) as Question["correctIdx"],
    tier,
    subject,
    subjectEmoji,
    source,
  };
}

// ---------- Local pack provider ----------
// The tier is never compromised: the class earned it, and it sets the points.
// Order: a question this session hasn't used, that this phone has never
// hosted (seen.ts), in a subject the period hasn't had; then one hosted on an
// earlier night; then any subject; finally a repeat of the tier.
const usedLocal = new Set<RawQuestion>();

function localPools(tier: Tier, taken: Set<string>): RawQuestion[][] {
  const ofTier = LOCAL_PACK.filter((q) => q.tier === tier);
  const fresh = ofTier.filter((q) => !usedLocal.has(q));
  const unseen = fresh.filter((q) => !isSeen(q.text));
  return [unseen.filter((q) => !taken.has(q.subject)), fresh.filter((q) => !taken.has(q.subject)), unseen, fresh, ofTier];
}

function takeLocal(pool: RawQuestion[], taken: Set<string>): Question {
  const pick = pool[Math.floor(Math.random() * pool.length)];
  usedLocal.add(pick);
  taken.add(pick.subject);
  const own = SUBJECTS.find((s) => s.label === pick.subject);
  return buildQuestion(pick, pick.tier, pick.subject, own?.emoji ?? "🏫", "local");
}

function drawLocal(tier: Tier, taken: Set<string>): Question {
  return takeLocal(localPools(tier, taken).find((p) => p.length)!, taken);
}

/** v0.29: only the first choice (never hosted on this phone, a subject the
 *  period hasn't had), or null. */
function drawFreshLocal(tier: Tier, taken: Set<string>): Question | null {
  const [best] = localPools(tier, taken);
  return best.length ? takeLocal(best, taken) : null;
}

// ---------- OpenTDB provider ----------
interface OtdbResponse {
  response_code: number;
  results: {
    question: string;
    correct_answer: string;
    incorrect_answers: string[];
  }[];
}

let sessionToken: string | null = null;
let lastRequestAt = 0;
// v0.9: OpenTDB allows ~1 request per 5s per IP, shared by everyone on the same
// network. When it says "too many" (HTTP 429), double the gap (up to a
// minute) instead of hammering it; ease back once requests go through.
let spacing = REQUEST_SPACING_MS;
const MAX_SPACING_MS = 60_000;

// One queue for every request: two callers used to read the same
// lastRequestAt, wait the same time and fire together (a 429 every time).
let queue: Promise<unknown> = Promise.resolve();

function spacedFetch(url: string): Promise<Response> {
  const run = queue.then(async () => {
    const wait = lastRequestAt + spacing - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastRequestAt = Date.now();
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    spacing = res.status === 429 ? Math.min(MAX_SPACING_MS, spacing * 2) : Math.max(REQUEST_SPACING_MS, Math.round(spacing * 0.8));
    return res;
  });
  queue = run.catch(() => {});
  return run;
}

async function ensureToken(): Promise<string | null> {
  if (sessionToken) return sessionToken;
  try {
    const res = await spacedFetch("https://opentdb.com/api_token.php?command=request");
    const data = await res.json();
    if (data.response_code === 0 && data.token) sessionToken = data.token;
  } catch {
    /* token is an optimization (no repeats), not a requirement */
  }
  return sessionToken;
}

async function fetchOne(subject: SubjectDef, tier: Tier): Promise<Question> {
  const token = await ensureToken();
  const base = `https://opentdb.com/api.php?amount=1&category=${subject.cat}&difficulty=${tier}&type=multiple`;
  let res = await spacedFetch(base + (token ? `&token=${token}` : ""));
  let data: OtdbResponse = await res.json();
  if (data.response_code === 3 || data.response_code === 4) {
    // Token not found / exhausted: reset and retry once without the token.
    sessionToken = null;
    res = await spacedFetch(base);
    data = await res.json();
  }
  if (data.response_code !== 0 || !data.results.length) throw new Error(`OpenTDB code ${data.response_code}`);
  const r = data.results[0];
  return buildQuestion(
    {
      text: decodeEntities(r.question),
      correct: decodeEntities(r.correct_answer),
      incorrect: r.incorrect_answers.map(decodeEntities) as [string, string, string],
    },
    tier,
    subject.label,
    subject.emoji,
    "opentdb",
  );
}

// ---------- Online questions, ready ahead of time ----------
// v0.26: a few questions of each tier wait in the background (medium most:
// every period starts there, and the curve mostly stays near it). A question
// this phone has already hosted is dropped; three misses in a row stop the
// filling until the next period.
const READY: Record<Tier, number> = { medium: 3, hard: 2, easy: 1 };
const ready: Record<Tier, Question[]> = { easy: [], medium: [], hard: [] };
let filling = false;
let misses = 0;

const wanted = (): Tier | null => (["medium", "hard", "easy"] as const).find((t) => ready[t].length < READY[t]) ?? null;

async function fill(): Promise<void> {
  if (filling) return;
  filling = true;
  try {
    for (let t = wanted(); t && misses < 3; t = wanted()) {
      const have = new Set(ready[t].map((q) => q.subject));
      const subject = shuffle(SUBJECTS).find((sub) => !have.has(sub.label)) ?? SUBJECTS[0];
      try {
        const q = await fetchOne(subject, t);
        if (isSeen(q.text)) misses++;
        else {
          misses = 0;
          ready[t].push(q);
        }
      } catch {
        misses++;
      }
    }
  } finally {
    filling = false;
  }
}

/** The seam the engine pulls questions through, one at a time (v0.26). The
 *  live game uses the local pack with OpenTDB behind it (v0.29); the
 *  simulator and replay fixtures plug in their own. */
export interface QuestionSource {
  /** Get the next period's questions ready in the background. */
  prefetch(): void;
  /** A new period (or, after a host reload, the one in progress with the
   *  questions it has asked): subjects start over. */
  start(asked?: Question[]): void;
  /** The next question, of this tier, in a subject the period hasn't had
   *  while one is left. Never waits, never throws. */
  next(tier: Tier): Question;
}

let taken = new Set<string>();

export const openTdbSource: QuestionSource = {
  prefetch() {
    misses = 0;
    void fill();
  },
  start(asked = []) {
    taken = new Set(asked.map((q) => q.subject));
  },
  next(tier) {
    // v0.29: the curated pack first (written for an international, mostly
    // European class, and fact-checked twice); OpenTDB leans American. An
    // online question only when the pack has none this phone hasn't hosted
    // in a subject the period hasn't had: still better than a repeat.
    const own = drawFreshLocal(tier, taken);
    const i = own ? -1 : ready[tier].findIndex((q) => !taken.has(q.subject));
    const q = own ?? (i >= 0 ? ready[tier].splice(i, 1)[0] : drawLocal(tier, taken));
    taken.add(q.subject);
    markSeen(q.text);
    void fill(); // top the shelf back up while the class plays
    return q;
  },
};

/** Offline-only source: exactly the fallback path the live game takes when
 *  no online question is ready, without touching the network. */
let localTaken = new Set<string>();
export const localOnlySource: QuestionSource = {
  prefetch() {},
  start(asked = []) {
    localTaken = new Set(asked.map((q) => q.subject));
  },
  next(tier) {
    return drawLocal(tier, localTaken);
  },
};

/** Forget which local questions this session has used (a new session). */
export function resetLocalDeck(): void {
  usedLocal.clear();
}

/** v0.18: which questions this session has used (local pack indexes and the
 *  OpenTDB session token), saved with the host's game so a reload keeps
 *  avoiding repeats. */
export interface DeckState {
  local: number[];
  token: string | null;
}

export function deckState(): DeckState {
  return { local: LOCAL_PACK.flatMap((q, i) => (usedLocal.has(q) ? [i] : [])), token: sessionToken };
}

export function restoreDeck(d: DeckState | undefined): void {
  if (!d) return;
  for (const i of d.local) if (LOCAL_PACK[i]) usedLocal.add(LOCAL_PACK[i]);
  if (d.token) sessionToken = d.token;
}
