// Source check: where the live game's questions come from (v0.29) — the
// curated pack first, OpenTDB only when the pack has nothing new. OpenTDB is
// stubbed (no network), on a virtual clock. Run: npx tsx sim/source-check.ts
//   · with online questions ready, a whole period comes from the pack
//   · when every pack question of the tier is used, the online ones come
//     before any repeat; then the pack repeats rather than stall
//   · other tiers still come from the pack first
import type { Question, Tier } from "../shared/protocol";
import { QUESTIONS_PER_MATCH } from "../shared/protocol";
import { LOCAL_PACK } from "../client/src/localPack";
import { openTdbSource, resetLocalDeck, restoreDeck } from "../client/src/providers";
import { mulberry32, VirtualClock } from "./harness";

const clock = new VirtualClock();
clock.install();
resetLocalDeck();
Math.random = mulberry32(20291026);
// decodeEntities' textarea, as plain text.
Object.assign(globalThis, {
  document: {
    createElement: () => {
      let html = "";
      return {
        set innerHTML(v: string) {
          html = v;
        },
        get value() {
          return html;
        },
      };
    },
  },
});
let failures = 0;
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? "✓" : "✗"} ${what}`);
  if (!ok) failures++;
};

// A stand-in OpenTDB: a session token, then one numbered question per request.
let calls = 0;
globalThis.fetch = (async (url: string | URL | Request) => {
  calls++;
  const body = String(url).includes("api_token")
    ? { response_code: 0, token: "T" }
    : { response_code: 0, results: [{ question: `Online question ${calls}?`, correct_answer: "Right", incorrect_answers: ["Wrong 1", "Wrong 2", "Wrong 3"] }] };
  return { status: 200, json: async () => body } as unknown as Response;
}) as typeof fetch;
const draw = (tier: Tier, n: number): Question[] => Array.from({ length: n }, () => openTdbSource.next(tier));

// The shelf fills in the background, ≥5 s between requests: a token, then
// three medium, two hard and one easy question.
openTdbSource.prefetch();
await clock.runUntil(() => calls >= 7);
for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));

// ---- A fresh night: the pack first ----
openTdbSource.start();
const period = draw("medium", QUESTIONS_PER_MATCH);
check(period.every((q) => q.source === "local"), `with online questions ready, all ${QUESTIONS_PER_MATCH} of a period come from the pack`);
check(new Set(period.map((q) => q.subject)).size === QUESTIONS_PER_MATCH, "…in ten different subjects");
check(calls === 7, "…and nothing more is fetched while the shelf is full");

// ---- Every medium pack question used: online before a repeat ----
restoreDeck({ local: LOCAL_PACK.flatMap((q, i) => (q.tier === "medium" ? [i] : [])), token: null });
openTdbSource.start();
const online = draw("medium", 3);
check(online.every((q) => q.source === "opentdb" && q.tier === "medium"), "with every medium pack question used, the three online ones come next");
check(new Set(online.map((q) => q.subject)).size === 3, "…each in its own subject");
const repeat = openTdbSource.next("medium");
check(repeat.source === "local" && repeat.tier === "medium", "…then the pack repeats its tier rather than stall");
check(openTdbSource.next("hard").source === "local", "other tiers still come from the pack first");

process.exit(failures ? 1 : 0);
