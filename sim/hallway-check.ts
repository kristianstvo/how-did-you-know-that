// Engine check: the hallway (v0.7), against the real engine on a virtual
// clock (no browser, no network). Run: npx tsx sim/hallway-check.ts
//   · someone arriving mid-period gets in, into the hallway, not the match
//   · they are never the cheater and never in this period's results
//   · names are still unique (at the report card too); a phone that drops
//     out keeps its place (same id), a place that lapses isn't seated
//   · Add bot counts the hallway; a quick change of suspect sticks
//   · back in homeroom they have a seat for the next period
//   · a big screen (v0.16) watches without a seat; at most MAX_SCREENS
import { HostEngine, type Transport } from "../client/src/engine";
import { localOnlySource, resetLocalDeck } from "../client/src/providers";
import { MAX_PLAYERS, MAX_SCREENS } from "../shared/protocol";
import { VirtualClock } from "./harness";

const clock = new VirtualClock();
clock.install();
resetLocalDeck();

const sent: { to: string; event: string; payload: { secret?: { isCheater: boolean }; reason?: string; playerId?: string; token?: string } }[] = [];
let broadcasts = 0;
const transport: Transport = {
  toAll: (event) => {
    if (event === "state") broadcasts++;
  },
  toPlayer: (to, event, payload) => sent.push({ to, event, payload: payload as never }),
  local: () => {},
};
const engine = new HostEngine("HALLX", "Hana", "🎒", transport, localOnlySource);
let failures = 0;
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? "✓" : "✗"} ${what}`);
  if (!ok) failures++;
};
const lastTo = (to: string) => [...sent].reverse().find((m) => m.to === to);

for (const [sid, name] of [["s1", "Bea"], ["s2", "Cy"], ["s3", "Dee"]]) engine.handleJoinRequest(sid, name, "📚");
void engine.startMatch();
await clock.runUntil(() => engine.publicState().phase === "question");

engine.handleJoinRequest("late", "Eve", "🎨");
const joined = lastTo("late");
let st = engine.publicState();
check(joined?.event === "joined", "someone arriving mid-period is let in");
check(!!st.hallway?.some((h) => h.name === "Eve") && !st.players.some((p) => p.name === "Eve"), "into the hallway, not into the match");
check(joined?.payload.secret?.isCheater === false, "they are never the cheater");

engine.handleJoinRequest("late2", "eve", "🎨");
check(lastTo("late2")?.event === "joinRejected", "names stay unique in the hallway");
// v0.11: dropping out of the hallway keeps the place for that phone (the
// same id when it comes back); nobody sees it meanwhile.
engine.handleJoinRequest("late3", "Fay", "🧪");
const fay = lastTo("late3")!.payload;
engine.handlePeerDisconnected("late3");
check(!engine.publicState().hallway?.some((h) => h.name === "Fay"), "someone who drops out of the hallway leaves the list");
engine.handleJoinRequest("late3b", "Fay", "🧪", fay.token);
check(lastTo("late3b")?.event === "joined" && lastTo("late3b")?.payload.playerId === fay.playerId, "the same phone coming back keeps its hallway place (same id)");
engine.handlePeerDisconnected("late3b"); // …and then leaves for good

// v0.11: every change of suspect counts (the latest wins); a flurry of them
// shares one broadcast, then the class sees the last one.
const ids = Object.fromEntries(engine.publicState().players.map((p) => [p.name, p.id]));
const beaPoints = () => engine.publicState().players.find((p) => p.name === "Bea")?.pointingAt;
const sentBefore = broadcasts;
engine.handleIntent("s1", { kind: "point", targetPlayerId: ids.Cy });
engine.handleIntent("s1", { kind: "point", targetPlayerId: ids.Dee });
check(beaPoints() === ids.Dee && broadcasts - sentBefore === 1, "a quick change of suspect sticks (the latest wins), in one broadcast");
await clock.runUntil(() => broadcasts - sentBefore >= 2);
check(beaPoints() === ids.Dee, "…and the class is told a moment later");

// v0.11: Add bot counts the hallway, so the room never overfills.
const inRoom = () => engine.publicState().players.length + (engine as unknown as { hallway: unknown[] }).hallway.length;
for (let i = 1; inRoom() < MAX_PLAYERS; i++) engine.handleJoinRequest(`w${i}`, `W${i}`, "🎲");

// The period ends (any way); the report card leaves the hallway out.
(engine as unknown as { endMatch(r: string): void }).endMatch("top_score");
st = engine.publicState();
check(!st.players.some((p) => p.name === "Eve"), "the report card is this period's class only");
engine.addBot();
check(inRoom() === MAX_PLAYERS, "Add bot never overfills the room (the hallway counts)");
engine.handleJoinRequest("dup", "Eve", "🎨");
check(lastTo("dup")?.event === "joinRejected", "a name waiting in the hallway is taken at the report card too");
setTimeout(() => engine.advance(), 12_000); // the host taps "Back to homeroom"
await clock.runUntil(() => engine.publicState().phase === "lobby");
st = engine.publicState();
const eve = st.players.find((p) => p.name === "Eve");
check(!!eve && (st.hallway ?? []).length === 0, "back in homeroom, the hallway takes its seats");
check(!!eve && st.sessionBoard[eve.id] === 0, "with a fresh line on the semester board");
check(!st.players.some((p) => p.name === "Fay"), "a hallway place that lapsed isn't seated");

// v0.10: between periods the host clears the seat of someone who left —
// never someone still here, never the host.
const host = st.players.find((p) => p.isHost)!;
const bea = st.players.find((p) => p.name === "Bea")!;
engine.removePlayer(bea.id);
check(engine.publicState().players.some((p) => p.id === bea.id), "a classmate who is still here can't be removed");
engine.removePlayer(host.id);
check(engine.publicState().players.some((p) => p.id === host.id), "the teacher can't be removed");
engine.handlePeerDisconnected("s1"); // Bea leaves for good
engine.removePlayer(bea.id);
st = engine.publicState();
check(!st.players.some((p) => p.id === bea.id) && !(bea.id in st.sessionBoard), "the seat of someone who left can be cleared");

// v0.16: a big screen (TV, laptop) watches the show without being in the class.
engine.handleJoinRequest("tv1", "Big screen", "📺", "", true);
st = engine.publicState();
const tv = lastTo("tv1");
check(tv?.event === "joined" && tv.payload.playerId === "" && st.screens === 1, "a big screen joins, with no player id");
check(!st.players.some((p) => p.name === "Big screen") && !(st.hallway ?? []).some((h) => h.name === "Big screen"), "…and takes no desk and no hallway place");
check(tv?.payload.secret?.isCheater === false, "…and is never told it's the cheater");
for (const id of ["tv2", "tv3", "tv4"]) engine.handleJoinRequest(id, "Big screen", "📺", "", true);
check(lastTo("tv4")?.event === "joinRejected" && engine.publicState().screens === MAX_SCREENS, `at most ${MAX_SCREENS} big screens per classroom`);
engine.handlePeerDisconnected("tv1");
check(engine.publicState().screens === MAX_SCREENS - 1, "a big screen that leaves stops counting");
process.exit(failures ? 1 : 0);
