// Engine check: "No way you knew that!" (v0.23) — an accusation names a
// suspect, who has the floor before ballots open. The real engine on a
// virtual clock: the teacher plus three phones (S1 is the cheater), no bots
// until the last period. Run: npx tsx sim/accuse-check.ts
//   · naming nobody, yourself, someone unknown or someone in detention is
//     refused, and the token is kept
//   · a valid accusation: the accused on record, the accuser's 👉 and ballot
//     on them, ballots shut for the floor (a bot's floor is shorter)
//   · the floor runs its course: early ballots and a dropout don't end it
//   · the accuser's gold star is for naming the cheater, not for any catch
//   · a host reload during the floor keeps it, and the vote resolves on time
import { matchEndTimeline, VOTE_EARLY_MS, VOTE_FLOOR_BOT_MS, VOTE_FLOOR_MS, voteResultTimeline } from "../shared/choreo";
import { createEventLogger, type MatchEvent } from "../shared/eventlog";
import type { Intent, PublicState } from "../shared/protocol";
import { HostEngine, type Transport } from "../client/src/engine";
import { localOnlySource, resetLocalDeck } from "../client/src/providers";
import { mulberry32, VirtualClock } from "./harness";

const clock = new VirtualClock();
clock.install();
resetLocalDeck();
Math.random = mulberry32(20261025);
let failures = 0;
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? "✓" : "✗"} ${what}`);
  if (!ok) failures++;
};
const events: MatchEvent[] = [];
const log = createEventLogger((e) => events.push(e));
const transport: Transport = {
  toAll: (event, payload) => {
    if (event === "state") log((payload as { state: PublicState }).state, Date.now());
  },
  toPlayer: () => {},
  local: () => {},
};
const OPTS = { beatLeadMs: 0, forceCheaterName: "S1" };
let engine = new HostEngine("ACCUS", "Hana", "🎒", transport, localOnlySource, OPTS);
for (const [sid, name, face] of [["s1", "S1", "📚"], ["s2", "S2", "✏️"], ["s3", "S3", "🧪"]]) engine.handleJoinRequest(sid, name, face);

const st = () => engine.publicState();
const idOf = (name: string) => engine.players.find((p) => p.name === name)!.id;
const seat = (name: string) => engine.players.find((p) => p.name === name)!;
const host = () => engine.hostPlayer;
const as = (sid: string, intent: Intent) => (sid === "host" ? engine.localIntent(intent) : engine.handleIntent(sid, intent));
const accuse = (sid: string, target: string) => as(sid, { kind: "burnToken", targetPlayerId: idOf(target) });
const ballot = (sid: string, target: string) => as(sid, { kind: "castVote", targetPlayerId: idOf(target) });
/** Run the virtual clock to shared-clock time t. */
const at = async (t: number) => {
  let hit = false;
  setTimeout(() => (hit = true), Math.max(0, t - Date.now()));
  await clock.runUntil(() => hit && Date.now() >= t, 500_000);
};
/** Nobody answers: every question runs to its timer, and the first reveal comes. */
const toFirstReveal = async () => {
  void engine.startMatch();
  await clock.runUntil(() => st().phase === "reveal", 500_000);
  await at(st().match!.reveal!.accuseAt);
};
/** The teacher taps Continue once the vote result has played, then Back to homeroom. */
const continueToLobby = async () => {
  const vr = st().match!.voteResult!;
  await at(st().phaseStartedAt + voteResultTimeline(Object.keys(vr.votes).length, vr.newThreshold !== null).end);
  engine.advance();
};
const backToLobby = async () => {
  await at(st().phaseStartedAt + matchEndTimeline(st().match!.end!.reason).end);
  engine.advance();
};

// ---- Period 1: the teacher names the cheater ----
await toFirstReveal();
as("host", { kind: "burnToken" } as unknown as Intent);
as("host", { kind: "burnToken", targetPlayerId: host().id });
as("host", { kind: "burnToken", targetPlayerId: "nobody" });
check(st().phase === "reveal" && !host().tokenUsed, "naming nobody, yourself or someone unknown is refused, and the token is kept");

accuse("host", "S1");
let v = st().match!.vote!;
check(st().phase === "vote" && v.accusedId === idOf("S1"), "a valid accusation opens the vote with the accused on record");
check(v.opensAt! - st().phaseStartedAt === VOTE_FLOOR_MS && v.deadline - v.opensAt! === st().settings.voteWindowMs, `the accused has the floor for ${VOTE_FLOOR_MS / 1000}s, then the ballot window opens`);
check(host().votedCurrent && host().pointingAt === idOf("S1") && host().tokenUsed, "the accuser's 👉 and ballot are on the accused (no take-backs)");
check(engine.players.filter((p) => !p.isHost).every((p) => !p.votedCurrent), "…and nobody else's ballot is in");
const ev = events.find((e) => e.type === "accuse");
check(ev?.type === "accuse" && ev.accusedId === idOf("S1"), "the event log's accusation names the accused");

await at(v.opensAt! - 1000);
ballot("s2", "S1");
check(!seat("S2").votedCurrent, "a ballot during the floor is ignored");
engine.handlePeerDisconnected("s3");
check(st().phase === "vote", "a classmate dropping out during the floor doesn't end it");
await at(v.opensAt!);
ballot("s2", "S1");
check(seat("S2").votedCurrent, "once ballots open, the ballot goes in");
ballot("s1", "S2");
const vr1 = st().match!.voteResult;
check(st().phase === "voteResult" && vr1?.accusedId === idOf("S1") && vr1.banishedId === idOf("S1") && vr1.wasCheater, "the class sends the accused, the cheater, to detention");
check(vr1?.votes[host().id] === idOf("S1"), "the accuser's ballot counted");
await continueToLobby();
let end = st().match!.end!;
check(st().phase === "matchEnd" && end.sessionDelta[host().id] === 3, `the accuser earns +3 (+2 for the vote, +1 for naming the cheater): ${end.sessionDelta[host().id]}`);
await backToLobby();
engine.handleJoinRequest("s3b", "S3", "🧪"); // back for the next period

// ---- Period 2: S2 names S3, but the class sends S1 ----
await toFirstReveal();
accuse("s2", "S3");
v = st().match!.vote!;
check(st().phase === "vote" && v.accusedId === idOf("S3") && !("votes" in v), "S2 names S3 (the public vote carries no ballots)");
await at(v.opensAt! - VOTE_EARLY_MS + 50);
ballot("host", "S1");
ballot("s3b", "S1");
ballot("s1", "S2");
check(seat("Hana").votedCurrent && seat("S3").votedCurrent, `a ballot in the last ${VOTE_EARLY_MS}ms of the floor is taken (clock skew, relay delay)`);
check(st().phase === "vote", "…but the vote never resolves before ballots open, even with every ballot in");
engine.handlePeerDisconnected("s3b"); // nobody left to wait for
check(st().phase === "vote", "…nor when the accused drops out during their own floor");
await at(v.opensAt!);
const vr2 = st().match!.voteResult;
check(st().phase === "voteResult" && vr2?.accusedId === idOf("S3") && vr2.banishedId === idOf("S1") && vr2.wasCheater, "…it resolves the moment they do: the class sends S1");
await continueToLobby();
end = st().match!.end!;
check((end.sessionDelta[idOf("S2")] ?? 0) === 0, `S2 named an innocent and voted for them: neither +1 nor +2 (${end.sessionDelta[idOf("S2")] ?? 0})`);
check(end.sessionDelta[host().id] === 2 && end.sessionDelta[idOf("S3")] === 2, "…while the voters who caught S1 get +2");
await backToLobby();
engine.handleJoinRequest("s3c", "S3", "🧪"); // back for the next period

// ---- Period 3: nobody may name a classmate in detention ----
await toFirstReveal();
accuse("host", "S2");
v = st().match!.vote!;
await at(v.opensAt!);
ballot("s3c", "S2");
ballot("s2", "S1");
ballot("s1", "S3");
check(st().match!.voteResult?.banishedId === idOf("S2") && !st().match!.voteResult?.wasCheater, "S2, an innocent, goes to detention");
await continueToLobby(); // Continue: back to the same reveal
check(st().phase === "reveal" && seat("S2").banished, "back on the reveal");
accuse("s3c", "S2");
check(st().phase === "reveal" && !seat("S3").tokenUsed, "naming a classmate in detention is refused, and the token is kept");
accuse("s3c", "S1");
v = st().match!.vote!;
await at(v.opensAt!);
ballot("host", "S1");
ballot("s1", "S3");
await continueToLobby();
check(st().phase === "matchEnd" && st().match!.end!.reason === "cheater_banished", "…and can still name someone else");
await backToLobby();

// ---- Period 4: a bot's floor is shorter; a host reload during the floor ----
engine.addBot();
const bot = engine.players.find((p) => p.isBot)!;
await toFirstReveal();
engine.localIntent({ kind: "burnToken", targetPlayerId: bot.id });
v = st().match!.vote!;
check(st().phase === "vote" && v.accusedId === bot.id && v.opensAt! - st().phaseStartedAt === VOTE_FLOOR_BOT_MS, `a bot accused gets a ${VOTE_FLOOR_BOT_MS / 1000}s floor (isBot is public)`);
await at(st().phaseStartedAt + 1000);
const saved = JSON.stringify(engine.snapshot());
const before = JSON.stringify(st());
engine.stop(); // the old page is gone
engine = HostEngine.restore(JSON.parse(saved), transport, localOnlySource, OPTS);
const rv = st().match!.vote!;
check(JSON.stringify(st()) === before && rv.accusedId === v.accusedId && rv.opensAt === v.opensAt, "a host reload during the floor keeps the accused and the floor");
await at(rv.opensAt! - 1);
check(!seat(bot.name).votedCurrent, "…the bot's ballot waits for the floor");
await clock.runUntil(() => st().phase !== "vote", 500_000);
const resolvedAt = Date.now();
check(st().phase === "voteResult" && Object.keys(st().match!.voteResult!.votes).includes(bot.id), "…then goes in");
check(resolvedAt >= rv.deadline && resolvedAt <= rv.deadline + 500, `…and with three ballots never handed in, the vote resolves at the deadline (+${resolvedAt - rv.deadline}ms)`);
process.exit(failures ? 1 : 0);
