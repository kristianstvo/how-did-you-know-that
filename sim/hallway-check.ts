// Engine check: the hallway (v0.7), against the real engine on a virtual
// clock (no browser, no network). Run: npx tsx sim/hallway-check.ts
//   · someone arriving mid-period gets in, into the hallway, not the match
//   · they are never the cheater and never in this period's results
//   · names are still unique; leaving the hallway frees the place
//   · back in homeroom they have a seat for the next period
import { HostEngine, type Transport } from "../client/src/engine";
import { localOnlySource, resetLocalDeck } from "../client/src/providers";
import { VirtualClock } from "./harness";

const clock = new VirtualClock();
clock.install();
resetLocalDeck();

const sent: { to: string; event: string; payload: { secret?: { isCheater: boolean }; reason?: string } }[] = [];
const transport: Transport = {
  toAll: () => {},
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
engine.handleJoinRequest("late3", "Fay", "🧪");
engine.handlePeerDisconnected("late3");
check(!engine.publicState().hallway?.some((h) => h.name === "Fay"), "leaving the hallway frees the place");

// The period ends (any way); the report card leaves the hallway out.
(engine as unknown as { endMatch(r: string): void }).endMatch("top_score");
st = engine.publicState();
check(!st.players.some((p) => p.name === "Eve"), "the report card is this period's class only");
setTimeout(() => engine.advance(), 12_000); // the host taps "Back to homeroom"
await clock.runUntil(() => engine.publicState().phase === "lobby");
st = engine.publicState();
const eve = st.players.find((p) => p.name === "Eve");
check(!!eve && (st.hallway ?? []).length === 0, "back in homeroom, the hallway takes its seats");
check(!!eve && st.sessionBoard[eve.id] === 0, "with a fresh line on the semester board");

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
process.exit(failures ? 1 : 0);
