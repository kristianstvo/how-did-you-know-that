// Content pipeline (spec 06, school edition). Each match's 10 questions get
// 10 distinct school subjects. OpenTDB is fetched one slot at a time (host
// only, session token, ≥5s spacing) in the background; the tagged local pack
// fills any slot that isn't ready or errors. Game logic only sees Question.
import type { Question, Tier } from "../../shared/protocol";
import { SUBJECTS, TIER_PLAN } from "../../shared/protocol";
import { LOCAL_PACK, type RawQuestion } from "./localPack";

type SubjectDef = (typeof SUBJECTS)[number];

const REQUEST_SPACING_MS = 5200; // OpenTDB: ~1 request / 5s per IP
const MATCH_START_WAIT_MS = 8000; // max wait at match start before local-filling

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
// Prefers an exact subject+tier match, then same subject, then same tier.
// A session-wide used-set avoids repeats until the pool runs dry.
const usedLocal = new Set<RawQuestion>();

function drawLocal(subject: SubjectDef, tier: Tier): Question {
  const pools = [
    LOCAL_PACK.filter((q) => q.subject === subject.label && q.tier === tier),
    LOCAL_PACK.filter((q) => q.subject === subject.label),
    LOCAL_PACK.filter((q) => q.tier === tier),
    LOCAL_PACK,
  ];
  let pick: RawQuestion | undefined;
  for (const pool of pools) {
    const fresh = pool.filter((q) => !usedLocal.has(q));
    if (fresh.length) {
      pick = fresh[Math.floor(Math.random() * fresh.length)];
      break;
    }
  }
  if (!pick) {
    usedLocal.clear();
    pick = LOCAL_PACK[Math.floor(Math.random() * LOCAL_PACK.length)];
  }
  usedLocal.add(pick);
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

async function spacedFetch(url: string): Promise<Response> {
  const wait = lastRequestAt + REQUEST_SPACING_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequestAt = Date.now();
  return fetch(url, { signal: AbortSignal.timeout(8000) });
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
}

let prefetched: Prefetch | null = null;

function startPrefetch(): Prefetch {
  // 10 distinct subjects per match, mapped onto the fixed difficulty ramp.
  const plan = shuffle(SUBJECTS)
    .slice(0, TIER_PLAN.length)
    .map((subject, i) => ({ subject, tier: TIER_PLAN[i] }));
  const slots: (Question | null)[] = plan.map(() => null);
  const promise = (async () => {
    for (let i = 0; i < plan.length; i++) {
      try {
        slots[i] = await fetchOne(plan[i].subject, plan[i].tier);
      } catch {
        slots[i] = null; // local pack fills this slot at match start
      }
    }
  })();
  return { plan, slots, promise };
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
  let usedFallback = false;
  const questions = p.plan.map(({ subject, tier }, i) => {
    if (p.slots[i]) return p.slots[i]!;
    usedFallback = true;
    return drawLocal(subject, tier);
  });
  return { questions, usedFallback };
}
