// Engine check: grading on a curve (v0.26) — the class sets the difficulty.
// The real engine on a virtual clock: the teacher plus three phones, no bots.
// Run: npx tsx sim/curve-check.ts
//   · every period starts on medium
//   · everyone right → the next question is a tier harder (and says so);
//     nobody right → a tier easier; a mixed class → the same tier
//   · the tiers stop at easy and hard
//   · a phone away at the bell without an answer doesn't hold the class back;
//     a class that leaves every answer blank got it wrong
//   · each question is worth its tier's points; no subject twice in a period
//   · the last question names no next tier; a host reload keeps the curve
import type { Intent, PublicState, Question, Tier } from "../shared/protocol";
import { DEFAULT_SETTINGS, FIRST_TIER, QUESTIONS_PER_MATCH } from "../shared/protocol";
import { HostEngine, type Transport } from "../client/src/engine";
import { localOnlySource, resetLocalDeck } from "../client/src/providers";
import { mulberry32, VirtualClock } from "./harness";

const clock = new VirtualClock();
clock.install();
resetLocalDeck();
Math.random = mulberry32(20261026);
Object.assign(globalThis, { document: { createElement: () => ({ innerHTML: "", value: "" }) } });
let failures = 0;
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? "✓" : "✗"} ${what}`);
  if (!ok) failures++;
};
const transport: Transport = { toAll: () => {}, toPlayer: () => {}, local: () => {} };
const OPTS = { beatLeadMs: 0, forceCheaterName: "S1" };
let engine = new HostEngine("CURVE", "Hana", "🎒", transport, localOnlySource, OPTS);
for (const [sid, name, face] of [["s1", "S1", "📚"], ["s2", "S2", "✏️"], ["s3", "S3", "🧪"]]) engine.handleJoinRequest(sid, name, face);
const SIDS = ["host", "s1", "s2", "s3"] as const;

const st = (): PublicState => engine.publicState();
const asked = (): Question[] => (engine as unknown as { questions: Question[] }).questions;
const as = (sid: string, intent: Intent) => (sid === "host" ? engine.localIntent(intent) : engine.handleIntent(sid, intent));
const at = async (t: number) => {
  let hit = false;
  setTimeout(() => (hit = true), Math.max(0, t - Date.now()));
  await clock.runUntil(() => hit && Date.now() >= t, 500_000);
};
/** Everyone in `who` answers the current question: right, or wrong. */
function answer(who: readonly string[], right: boolean): void {
  const m = st().match!;
  const q = asked()[m.questionIdx];
  for (const sid of who) as(sid, { kind: "answer", questionIdx: m.questionIdx, optionIdx: right ? q.correctIdx : (q.correctIdx + 1) % 4, clientElapsedMs: 3000 });
}
/** Wait for the reveal of the current question (answers in, or the timer). */
const toReveal = async () => {
  await clock.runUntil(() => st().phase === "reveal" || st().phase === "matchEnd", 500_000);
};
/** The teacher's Next, once the reveal allows it. */
const next = async () => {
  await at(st().match!.reveal!.minNextAt);
  engine.advance();
  await clock.runUntil(() => st().phase === "question" || st().phase === "matchEnd", 500_000);
};
const tierNow = (): Tier => st().match!.question!.tier;

// ---- Period 1 ----
void engine.startMatch();
await clock.runUntil(() => st().phase === "question", 500_000);
check(tierNow() === FIRST_TIER && FIRST_TIER === "medium" && !st().match!.question!.shift, "the period starts on medium, with no stamp");
check(st().match!.question!.points === DEFAULT_SETTINGS.tierPoints.medium, "…worth a medium question's points");

// Q1 medium, everyone right → hard
answer(SIDS, true);
await toReveal();
check(st().match!.reveal!.next === "hard", "everyone right on medium: the reveal says the next one is hard");
await next();
check(tierNow() === "hard" && st().match!.question!.shift === "up", "…and Q2 is hard, stamped ▲ harder");
check(st().match!.question!.points === DEFAULT_SETTINGS.tierPoints.hard, "…worth a hard question's points");

// Q2 hard, everyone right → stays hard (the top)
answer(SIDS, true);
await toReveal();
check(st().match!.reveal!.next === "hard", "everyone right on hard: it stays hard (the top)");
await next();
check(tierNow() === "hard" && !st().match!.question!.shift, "…with no stamp");

// Q3 hard, mixed → stays
answer(["host", "s1"], true);
answer(["s2", "s3"], false);
await toReveal();
check(st().match!.reveal!.next === "hard", "a mixed class: the tier stays");
await next();

// Q4 hard, nobody right → medium
answer(SIDS, false);
await toReveal();
check(st().match!.reveal!.next === "medium", "nobody right on hard: the next one is medium");
await next();
check(tierNow() === "medium" && st().match!.question!.shift === "down", "…stamped ▼ easier");

// Q5 medium, nobody answers at all (everyone at the phone, the timer runs out) → easy
await toReveal();
check(st().match!.reveal!.next === "easy", "a class that leaves it blank got it wrong: easy next");
await next();
check(tierNow() === "easy", "…and Q6 is easy");

// Q6 easy, nobody right → stays easy (the bottom)
answer(SIDS, false);
await toReveal();
check(st().match!.reveal!.next === "easy", "nobody right on easy: it stays easy (the bottom)");
await next();

// Q7 easy: S3's phone drops out; everyone still here gets it right → medium
engine.handlePeerDisconnected("s3");
answer(["host", "s1", "s2"], true);
await toReveal();
check(st().match!.reveal!.next === "medium", "a phone away at the bell without an answer doesn't hold the class back");
// S3 comes back with the seat's token before the next question.
const s3 = engine.players.find((p) => p.name === "S3")!;
engine.handleJoinRequest("s3b", "S3", "🧪", s3.token);
await next();
check(tierNow() === "medium" && st().match!.question!.shift === "up", "…Q8 is medium, stamped ▲ harder");

// A host reload mid-period: the snapshot keeps the questions so far and the curve.
answer(["host", "s1", "s2", "s3b"], true);
await toReveal();
check(st().match!.reveal!.next === "hard", "Q8 everyone right: hard next");
const snap = engine.snapshot();
const before = asked().map((q) => q.text);
engine.stop();
engine = HostEngine.restore(JSON.parse(JSON.stringify(snap)), transport, localOnlySource, OPTS);
check(asked().map((q) => q.text).join("|") === before.join("|"), "a host reload keeps the questions asked so far");
await next();
check(tierNow() === "hard", "…and Q9 comes at the tier the class earned before the reload");
const subjects = asked().map((q) => q.subject);
check(new Set(subjects).size === subjects.length, "no subject twice in the period (the reload included)");

// Q9 → Q10, then the last reveal names no next tier.
answer(["host", "s1", "s2", "s3b"], false);
await toReveal();
await next();
check(st().match!.questionIdx === QUESTIONS_PER_MATCH - 1 && tierNow() === "medium", "Q10 follows the curve too");
answer(["host", "s1", "s2", "s3b"], true);
await toReveal();
const lastReveal = st().match!.reveal;
check(!!lastReveal && lastReveal.next === undefined, "the last question's reveal names no next tier");

// ---- Period 2 starts on medium again ----
if (st().phase === "reveal") {
  await at(st().match!.reveal!.minNextAt);
  engine.advance(); // Q10 → the report card
}
await clock.runUntil(() => st().phase === "matchEnd", 500_000);
await at(st().phaseStartedAt + 60_000);
engine.advance(); // → homeroom
await clock.runUntil(() => st().phase === "lobby", 500_000);
void engine.startMatch();
await clock.runUntil(() => st().phase === "question", 500_000);
check(tierNow() === "medium" && !st().match!.question!.shift, "the next period starts on medium again");

process.exit(failures ? 1 : 0);
