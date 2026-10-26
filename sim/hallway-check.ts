// Engine check: the hallway (v0.7), against the real engine on a virtual
// clock (no browser, no network). Run: npx tsx sim/hallway-check.ts
//   · someone arriving mid-period gets in, into the hallway, not the match
//   · they are never the cheater and never in this period's results
//   · names are still unique (at the report card too); a phone that drops
//     out keeps its place (same id), a place that lapses isn't seated
//   · Add bot counts the hallway; a quick change of suspect sticks
//   · back in homeroom they have a seat for the next period
//   · a big screen (v0.16) watches without a seat; at most MAX_SCREENS
//   · v0.24 one face per desk: no two in the room share a student; a bot's
//     student is claimable in homeroom only; a rejoin keeps its face; Add
//     bot skips the hallway's faces; a taken name is rejected on the name,
//     with a free one to join as (not for a seat held mid-match, nor in a
//     full room)
//   · after the unmask the room cheers, the hallway too, within the caps (v0.25)
import { HostEngine, type Transport } from "../client/src/engine";
import { localOnlySource, resetLocalDeck } from "../client/src/providers";
import { AVATARS, MAX_PLAYERS, MAX_SCREENS } from "../shared/protocol";
import { VirtualClock } from "./harness";

const clock = new VirtualClock();
clock.install();
resetLocalDeck();

const sent: {
  to: string;
  event: string;
  payload: { secret?: { isCheater: boolean }; reason?: string; field?: string; suggest?: string; playerId?: string; token?: string };
}[] = [];
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
const joinedTo = (to: string) => sent.find((m) => m.to === to && m.event === "joined");
// v0.24: everyone in the room, the hallway too (connected or not).
const hallOf = (e: HostEngine) => (e as unknown as { hallway: { id: string; name: string; avatar: string }[] }).hallway;
const everyone = (e: HostEngine) => [...e.players, ...hallOf(e)];
const faceOf = (e: HostEngine, name: string) => everyone(e).find((p) => p.name === name)?.avatar;
const facesUnique = (e: HostEngine) => {
  const faces = everyone(e).map((p) => p.avatar);
  return new Set(faces).size === faces.length && faces.every((a) => AVATARS.includes(a));
};
/** A taken-name rejection: on the name, offering a free one nobody uses. */
const nameRejected = (e: HostEngine, to: string, suggest: string) => {
  const m = lastTo(to);
  const names = everyone(e).map((p) => p.name.toLowerCase());
  return m?.event === "joinRejected" && m.payload.field === "name" && m.payload.suggest === suggest && !names.includes(suggest.toLowerCase());
};

for (const [sid, name] of [["s1", "Bea"], ["s2", "Cy"], ["s3", "Dee"]]) engine.handleJoinRequest(sid, name, "📚");
check(faceOf(engine, "Bea") === "📚" && facesUnique(engine), "three joiners asking for the Bookworm get three different students (v0.24)");
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
check(nameRejected(engine, "late2", "eve 2"), "…on the name, offering one nobody uses (v0.24)");
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
check(facesUnique(engine), "a full room, the hallway too: still one face per desk (v0.24)");

// The period ends (any way); the report card leaves the hallway out.
(engine as unknown as { endMatch(r: string): void }).endMatch("top_score");
st = engine.publicState();
check(!st.players.some((p) => p.name === "Eve"), "the report card is this period's class only");
engine.addBot();
check(inRoom() === MAX_PLAYERS, "Add bot never overfills the room (the hallway counts)");
engine.handleJoinRequest("dup", "Eve", "🎨");
check(lastTo("dup")?.event === "joinRejected", "a name waiting in the hallway is taken at the report card too");
check(
  lastTo("dup")?.payload.field === "name" && lastTo("dup")?.payload.suggest === undefined,
  "…rejected on the name, but a full room has no desk for an \"Eve 2\" to offer (v0.24)",
);
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

// v0.24: one face per desk. A bot's student is the joiner's for the asking,
// but only in homeroom; a seated human's never is; a rejoin keeps its face.
const room = new HostEngine("FACES", "Hana", "🎒", transport, localOnlySource);
room.addBot(); // Sleepy Sam: the first free student
const sam = room.players.find((p) => p.isBot)!;
const samWas = sam.avatar;
room.handleJoinRequest("g1", "Gil", samWas);
check(
  faceOf(room, "Gil") === samWas && sam.avatar !== samWas && facesUnique(room),
  "in homeroom, a classmate asking for a bot's student gets them; the bot moves to a free one",
);
room.handleJoinRequest("g2", "Ivy", "💻");
room.addBot(); // Class Clown Cal
const cal = room.players.find((p) => p.isBot && p.id !== sam.id)!;
check(faceOf(room, "Ivy") === "💻" && facesUnique(room), "a free student goes to whoever asks; Add bot picks one nobody has");
void room.startMatch();
await clock.runUntil(() => room.publicState().phase === "question");
const calWas = cal.avatar;
room.handleJoinRequest("g3", "Jo", calWas);
check(faceOf(room, "Jo") !== calWas && cal.avatar === calWas && facesUnique(room), "mid-period, a latecomer asking for a bot's student gets another; the bot keeps theirs");
room.handleJoinRequest("g4", "Kit", "💻");
check(faceOf(room, "Kit") !== "💻" && faceOf(room, "Ivy") === "💻" && facesUnique(room), "a latecomer asking for a seated classmate's student gets another");
// Rejoins with the seat's token: Ivy keeps the Hacker; Gil, asking for
// Ivy's student (or Cal's, mid-period), keeps his own.
room.handlePeerDisconnected("g2");
room.handleJoinRequest("g2b", "Ivy", "💻", joinedTo("g2")!.payload.token);
room.handlePeerDisconnected("g1");
room.handleJoinRequest("g1b", "Gil", "💻", joinedTo("g1")!.payload.token);
room.handlePeerDisconnected("g1b");
room.handleJoinRequest("g1c", "Gil", calWas, joinedTo("g1")!.payload.token);
check(
  joinedTo("g2b")?.payload.playerId === joinedTo("g2")?.payload.playerId && faceOf(room, "Ivy") === "💻",
  "a token rejoin keeps its seat and its face",
);
check(faceOf(room, "Gil") === samWas && cal.avatar === calWas && facesUnique(room), "a rejoin asking for someone else's student keeps its own face");
// Taken names: the first free "<name> N", ignoring case, cut to fit the tag.
room.handleJoinRequest("g5", "ivy 2", "🎨");
room.handleJoinRequest("g6", "Ivy", "🎨");
check(nameRejected(room, "g6", "Ivy 3"), "a taken name offers the first free number (\"ivy 2\" is taken)");
room.handleJoinRequest("g7", "Bartholomew-Jones Jr", "🎨");
room.handleJoinRequest("g8", "bartholomew-jones jr", "🎨");
check(nameRejected(room, "g8", "bartholomew-jones 2"), "…cut to fit the 20-character name tag");
// The report card shows this period's faces (the unmasked cheater may be a
// bot): a bot's student isn't up for grabs there, for a newcomer or a rejoin.
(room as unknown as { endMatch(r: string): void }).endMatch("top_score");
const samNow = sam.avatar;
room.handleJoinRequest("g9", "Max", calWas);
check(
  room.players.some((p) => p.name === "Max") && faceOf(room, "Max") !== calWas && cal.avatar === calWas && facesUnique(room),
  "on the report card, a newcomer asking for a bot's student gets another; the bot keeps theirs",
);
room.handlePeerDisconnected("g1c");
room.handleJoinRequest("g1d", "Gil", samNow, joinedTo("g1")!.payload.token);
check(
  lastTo("g1d")?.event === "joined" && faceOf(room, "Gil") === samWas && sam.avatar === samNow,
  "…and a token rejoin asking for one keeps its own face",
);
check(facesUnique(room), "and after all of it, one face per desk");

// v0.24: a seat held mid-match isn't a taken name: it's usually its own phone
// in a new tab (the token is per tab). No "Bea 2" to split her in two; at the
// report card her name takes the seat back, stars and all.
const heldRoom = new HostEngine("HELDX", "Hana", "🎒", transport, localOnlySource);
heldRoom.handleJoinRequest("b1", "Bea", "📚");
heldRoom.handleJoinRequest("c1", "Cy", "🎨");
const beaId = joinedTo("b1")!.payload.playerId!;
void heldRoom.startMatch();
await clock.runUntil(() => heldRoom.publicState().phase === "question");
(heldRoom as unknown as { sessionBoard: Record<string, number> }).sessionBoard[beaId] = 7; // her stars so far today
heldRoom.handlePeerDisconnected("b1");
heldRoom.handleJoinRequest("b2", "Bea", "📚");
const heldMsg = lastTo("b2");
check(
  heldMsg?.event === "joinRejected" && heldMsg.payload.field === "name" && heldMsg.payload.suggest === undefined && hallOf(heldRoom).length === 0,
  "mid-period, a held seat's name (no token) goes back to the name tag, with no other name to offer",
);
(heldRoom as unknown as { endMatch(r: string): void }).endMatch("top_score");
const starsThen = heldRoom.publicState().sessionBoard[beaId];
heldRoom.handleJoinRequest("b3", "Bea", "📚");
check(
  lastTo("b3")?.payload.playerId === beaId && heldRoom.publicState().sessionBoard[beaId] === starsThen && starsThen >= 7 && heldRoom.players.length === 3,
  "…and at the report card her name takes the seat back, stars and all",
);

// v0.24: Add bot at the report card skips the hallway's faces too: they take
// their seats next period. The latecomer holds the first face no desk has.
const late = new HostEngine("HALLF", "Hana", "🎒", transport, localOnlySource);
late.addBot();
late.addBot();
void late.startMatch();
await clock.runUntil(() => late.publicState().phase === "question");
const firstFree = AVATARS.find((a) => !late.players.some((p) => p.avatar === a))!;
late.handleJoinRequest("h1", "Lu", firstFree);
(late as unknown as { endMatch(r: string): void }).endMatch("top_score");
late.addBot();
const lateBots = late.players.filter((p) => p.isBot);
check(
  lateBots.length === 3 && faceOf(late, "Lu") === firstFree && lateBots[2].avatar !== firstFree && facesUnique(late),
  "at the report card, Add bot picks a face nobody has, the hallway's included",
);
// v0.25 Tomatoes!: after the unmask, everyone in the room (the hallway too)
// may pelt or applaud the cheater, within the rate caps; a big screen can't.
{
  const wait = async (ms: number) => {
    let done = false;
    setTimeout(() => (done = true), ms);
    await clock.runUntil(() => done);
  };
  let states = 0;
  const room = new HostEngine("CHEER", "Hana", "🎒", { toAll: (ev) => ev === "state" && states++, toPlayer: () => {}, local: () => {} }, localOnlySource, { beatLeadMs: 0 });
  for (const [sid, name] of [["c1", "Bea"], ["c2", "Cy"], ["c3", "Dee"]]) room.handleJoinRequest(sid, name, "📚");
  void room.startMatch();
  await clock.runUntil(() => room.publicState().phase === "question");
  room.handleJoinRequest("hall", "Eve", "🎨"); // arrives mid-period: the hallway
  room.handleJoinRequest("tvc", "Big screen", "📺", "", true);
  const inner = room as unknown as { answers: Record<string, unknown>[]; hallway: { id: string; pointingAt: string | null }[]; endMatch(r: string): void };
  const eveId = inner.hallway[0].id;
  const beaId = room.publicState().players.find((p) => p.name === "Bea")!.id;
  room.handleIntent("hall", { kind: "answer", questionIdx: 0, optionIdx: 0, clientElapsedMs: 900 });
  room.handleIntent("hall", { kind: "point", targetPlayerId: beaId });
  check(!inner.answers[0][eveId] && inner.hallway[0].pointingAt === null && !room.publicState().players.some((p) => p.pointingAt), "the hallway's answers and points are still ignored");
  const cheers = () => room.publicState().match?.end?.cheers ?? { tomato: 0, clap: 0 };
  room.handleIntent("c1", { kind: "cheer", what: "tomato" });
  check(cheers().tomato === 0, "no tomatoes mid-period");
  inner.endMatch("cheater_banished"); // caught: the unmask lands 2.5s in
  room.handleIntent("c1", { kind: "cheer", what: "tomato" });
  room.localIntent({ kind: "cheer", what: "clap" });
  await wait(1200);
  room.handleIntent("c1", { kind: "cheer", what: "tomato" });
  check(cheers().tomato === 0 && cheers().clap === 0, "a cheer before the unmask is ignored");
  await wait(1400);
  room.handleIntent("c1", { kind: "cheer", what: "tomato" });
  room.handleIntent("c1", { kind: "cheer", what: "clap" });
  check(cheers().tomato === 1 && cheers().clap === 0, "two cheers within 250ms count once");
  await wait(260);
  const sentBefore = states;
  room.handleIntent("c1", { kind: "cheer", what: "clap" });
  check(cheers().clap === 1, "…and 250ms later the next one counts");
  room.handleIntent("hall", { kind: "cheer", what: "clap" });
  check(cheers().clap === 2, "a hallway phone's cheer counts");
  await wait(400);
  check(states - sentBefore === 1, "a flurry of cheers shares one broadcast (like pointers)");
  room.handleIntent("tvc", { kind: "cheer", what: "tomato" });
  room.handleIntent("c3", { kind: "cheer", what: "brick" as "tomato" });
  check(cheers().tomato === 1 && cheers().clap === 2, "a big screen's cheer, and a made-up one, are ignored");
  for (let i = 0; i < 31; i++) {
    room.handleIntent("c2", { kind: "cheer", what: "tomato" });
    await wait(260);
  }
  check(cheers().tomato === 31, "the 31st cheer from one phone is ignored (30 a period)");
  room.localIntent({ kind: "cheer", what: "tomato" });
  check(cheers().tomato === 32, "…while everyone else's still count");
}
process.exit(failures ? 1 : 0);
