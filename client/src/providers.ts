// Content pipeline (spec 06, school edition). Each match's 10 questions get
// 10 distinct school subjects. OpenTDB is fetched one slot at a time (host
// only, session token, ≥5s spacing) in the background; the tagged local pack
// fills any slot that isn't ready or errors. Game logic only sees Question.
import type { Question, Tier } from "../../shared/protocol";
import { SUBJECTS, TIER_PLAN } from "../../shared/protocol";
import { LOCAL_PACK, type RawQuestion } from "./localPack";

type SubjectDef = (typeof SUBJECTS)[number];

const REQUEST_SPACING_MS = 5200; // OpenTDB: ~1 request / 5s per IP
// v0.9: the curated pack (189 questions) is a good fallback now, so "Printing
// the quiz…" waits at most 3s for online slots instead of 8s.
const MATCH_START_WAIT_MS = 3000; // max wait at match start before local-filling

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
// The tier is never compromised — it sets the points ramp (spec 01). Order:
// fresh question in the requested subject; fresh question of the same tier
// from a subject this match isn't using; any fresh question of the tier;
// finally a repeat of the tier. A session-wide used-set avoids repeats.
const usedLocal = new Set<RawQuestion>();

function drawLocal(subject: SubjectDef, tier: Tier, taken: Set<string>): Question {
  const ofTier = LOCAL_PACK.filter((q) => q.tier === tier);
  const fresh = ofTier.filter((q) => !usedLocal.has(q));
  const pools = [
    fresh.filter((q) => q.subject === subject.label),
    fresh.filter((q) => !taken.has(q.subject)),
    fresh,
    ofTier,
  ];
  const pool = pools.find((p) => p.length)!;
  const pick = pool[Math.floor(Math.random() * pool.length)];
  usedLocal.add(pick);
  taken.add(pick.subject);
  // Display the question's OWN subject so the header never lies when the
  // fallback had to reach outside the requested subject.
  const own = SUBJECTS.find((s) => s.label === pick!.subject);
  return buildQuestion(pick, pick.tier, pick.subject, own?.emoji ?? "🏫", "local");
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

// ---------- Match batch assembly with progressive prefetch ----------
export interface MatchQuestions {
  questions: Question[]; // exactly 10, ordered per TIER_PLAN
  usedFallback: boolean; // any slot filled from the local pack (offline badge)
}

interface Prefetch {
  plan: { subject: SubjectDef; tier: Tier }[];
  slots: (Question | null)[]; // filled progressively as fetches complete
  promise: Promise<void>;
  /** The match started without waiting for the rest: stop fetching (v0.9). */
  done: boolean;
}

let prefetched: Prefetch | null = null;

function startPrefetch(): Prefetch {
  // 10 distinct subjects per match, mapped onto the fixed difficulty ramp.
  const plan = shuffle(SUBJECTS)
    .slice(0, TIER_PLAN.length)
    .map((subject, i) => ({ subject, tier: TIER_PLAN[i] }));
  const slots: (Question | null)[] = plan.map(() => null);
  const p: Prefetch = { plan, slots, promise: Promise.resolve(), done: false };
  p.promise = (async () => {
    for (let i = 0; i < plan.length; i++) {
      if (p.done) return; // its match already started with the local pack
      try {
        slots[i] = await fetchOne(plan[i].subject, plan[i].tier);
      } catch {
        slots[i] = null; // local pack fills this slot at match start
      }
    }
  })();
  return p;
}

/** Kick off fetching the next match's questions in the background
 *  (preferred strategy per spec 06 — zero perceived wait at match start). */
export function prefetchNextMatch(): void {
  if (!prefetched) prefetched = startPrefetch();
}

/** Get questions for a match: consume the prefetch, waiting briefly if it's
 *  still in flight; the local pack fills whatever isn't ready. Never throws. */
export async function getMatchQuestions(): Promise<MatchQuestions> {
  const p = prefetched ?? startPrefetch();
  prefetched = null;
  await Promise.race([p.promise, new Promise((r) => setTimeout(r, MATCH_START_WAIT_MS))]);
  p.done = true; // whatever isn't here now comes from the pack: stop fetching
  let usedFallback = false;
  const taken = new Set(p.plan.map((s) => s.subject.label));
  const questions = p.plan.map(({ subject, tier }, i) => {
    if (p.slots[i]) return p.slots[i]!;
    usedFallback = true;
    return drawLocal(subject, tier, taken);
  });
  return { questions, usedFallback };
}

/** The seam the engine pulls questions through. The live game uses OpenTDB
 *  with local fallback; the simulator and replay fixtures plug in their own. */
export interface QuestionSource {
  prefetch(): void;
  get(): Promise<MatchQuestions>;
}

export const openTdbSource: QuestionSource = { prefetch: prefetchNextMatch, get: getMatchQuestions };

/** Offline-only source: exactly the fallback path the live game takes when
 *  OpenTDB isn't ready, without touching the network. */
export const localOnlySource: QuestionSource = {
  prefetch() {},
  async get() {
    const plan = shuffle(SUBJECTS).slice(0, TIER_PLAN.length);
    const taken = new Set<string>(plan.map((s) => s.label));
    return { questions: plan.map((subject, i) => drawLocal(subject, TIER_PLAN[i], taken)), usedFallback: true };
  },
};

/** Forget which local questions this session has used (a new session). */
export function resetLocalDeck(): void {
  usedLocal.clear();
}
