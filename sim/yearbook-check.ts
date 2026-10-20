// Engine check: the yearbook (v0.8) — two full periods played by bots on the
// real engine (virtual clock), then the end of the day.
// Run: npx tsx sim/yearbook-check.ts
//   · every period: at most 4 superlatives, one per player, the cheater's first
//   · end of day: at most 4 day awards, one per player, each for a real event
//   · New day: same class; the event log keeps counting periods (v0.11)
import { HostEngine, type Transport } from "../client/src/engine";
import { localOnlySource, resetLocalDeck } from "../client/src/providers";
import { createEventLogger, type MatchEvent } from "../shared/eventlog";
import type { PublicState } from "../shared/protocol";
import { mulberry32, VirtualClock } from "./harness";

const clock = new VirtualClock();
clock.install();
resetLocalDeck();
Math.random = mulberry32(20261020);
const events: MatchEvent[] = [];
const log = createEventLogger((e) => events.push(e));
const transport: Transport = {
  toAll: (event, payload) => {
    if (event === "state") log((payload as { state: PublicState }).state, Date.now());
  },
  toPlayer: () => {},
  local: () => {},
};
const engine = new HostEngine("YEARB", "Hana", "🎒", transport, localOnlySource);
for (let i = 0; i < 5; i++) engine.addBot();

let failures = 0;
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? "✓" : "✗"} ${what}`);
  if (!ok) failures++;
};
// The host taps Next / Continue / Back to homeroom whenever it may.
const tap = () => {
  engine.advance();
  setTimeout(tap, 1000);
};
setTimeout(tap, 1000);

for (let period = 1; period <= 2; period++) {
  void engine.startMatch();
  await clock.runUntil(() => engine.publicState().phase === "matchEnd", 500_000);
  const st = engine.publicState();
  const e = st.match!.end!;
  const awards = e.awards ?? [];
  const ids = awards.map((a) => a.playerId);
  console.log(`  period ${period}: ${e.reason}${e.struckOut ? " (struck out)" : ""} · ${awards.map((a) => `${a.icon} ${a.title}`).join(" · ")}`);
  check(awards.length >= 1 && awards.length <= 4, `period ${period}: 1–4 superlatives`);
  check(new Set(ids).size === ids.length, `period ${period}: one per player`);
  check(ids[0] === e.cheaterId, `period ${period}: the cheater's comes first`);
  check(awards.every((a) => st.players.some((p) => p.id === a.playerId) && a.title && a.why), `period ${period}: every award names a classmate and a reason`);
  await clock.runUntil(() => engine.publicState().phase === "lobby", 500_000);
  const back = engine.publicState();
  check(back.players.every((p) => !p.banished && !p.tokenUsed && p.votingRights && !p.pointingAt), `period ${period}: back in homeroom, nobody is still in detention or out of accusations`);
}
engine.endSession();
const st = engine.publicState();
const day = st.dayAwards ?? [];
console.log(`  the day: ${day.map((a) => `${a.icon} ${a.title} (${a.why})`).join(" · ") || "nothing earned"}`);
check(st.phase === "sessionEnd" && Array.isArray(st.dayAwards), "the day's yearbook is published at session end");
check(day.length <= 4 && new Set(day.map((a) => a.playerId)).size === day.length, "at most 4 day awards, one per player");

// v0.10: the same class starts a new day — same room, fresh standings.
const before = st.players.map((p) => p.id).join(",");
engine.newDay();
const fresh = engine.publicState();
check(fresh.phase === "lobby" && fresh.matchNumber === 0, "New day: back in homeroom, period count reset");
check(fresh.players.map((p) => p.id).join(",") === before, "…with the same class in the same seats");
check(fresh.players.every((p) => fresh.sessionBoard[p.id] === 0 && p.score === 0) && !fresh.dayAwards, "…and fresh standings, no old awards");

// v0.11: day 2's first period is period 1 again to the engine, but the event
// log keeps counting (it used to merge it into day 1's and drop its reveals).
void engine.startMatch();
await clock.runUntil(() => engine.publicState().phase === "matchEnd", 500_000);
const starts = events.filter((e) => e.type === "matchStart").map((e) => e.match);
check(starts.join(",") === "1,2,3", `the event log numbers day 2's first period 3 (got ${starts.join(",")})`);
check(events.some((e) => e.type === "reveal" && e.match === 3) && events.some((e) => e.type === "matchEnd" && e.match === 3), "…and keeps its reveals and its ending");
process.exit(failures ? 1 : 0);
