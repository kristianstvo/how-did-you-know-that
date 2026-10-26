// Engine check: the yearbook (v0.8) — two full periods played by bots on the
// real engine (virtual clock), then the end of the day.
// Run: npx tsx sim/yearbook-check.ts
//   · every period: at most 4 superlatives, one per player, the cheater's first
//   · end of day: at most 4 day awards, one per player, each for a real event
//   · New day: same class; the event log keeps counting periods (v0.11)
//   · a day's first period holds the bell longer, through a host crash too (v0.27)
import { HostEngine, type Transport } from "../client/src/engine";
import { ROLE_SCREEN_FIRST_MS, ROLE_SCREEN_MS } from "../shared/choreo";
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
// v0.27: when each period's bell and question one began (shared clock).
const bells: { role: number; q1: number }[] = [];
const onBell = (s: PublicState) => {
  if (s.phase === "role" && bells.at(-1)?.role !== s.phaseStartedAt) bells.push({ role: s.phaseStartedAt, q1: 0 });
  if (s.phase === "question" && s.match?.questionIdx === 0 && bells.length && !bells.at(-1)!.q1) bells.at(-1)!.q1 = s.phaseStartedAt;
};
const transport: Transport = {
  toAll: (event, payload) => {
    if (event !== "state") return;
    log((payload as { state: PublicState }).state, Date.now());
    onBell((payload as { state: PublicState }).state);
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
  // v0.17: how the cheater played against the class, published with the result.
  const t = e.tells;
  console.log(`  how they played: cheater ${t?.cheater.right}/${t?.asked} right, ${t?.cheater.medianMs}ms median · class ${t?.class.right}/${t?.asked}, ${t?.class.medianMs}ms`);
  check(
    !!t && t.asked === st.match!.questionIdx + 1 && t.cheater.right <= t.asked && t.class.right <= t.asked && t.cheater.medianMs >= 0 && t.class.medianMs >= 0,
    `period ${period}: "how they played" counts the questions asked, and nobody gets more right than that`,
  );
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

// v0.27: nobody misses the bell. A day's first period holds it 5.2 s (the
// note lands at 1.7 s), later periods keep 3.2 s, and New day starts long again.
const held = bells.map((b) => b.q1 - b.role);
console.log(`  the bell held: ${held.map((ms) => `${ms}ms`).join(", ")}`);
check(held[0] === ROLE_SCREEN_FIRST_MS, `period 1: question one starts ${ROLE_SCREEN_FIRST_MS}ms after the bell (got ${held[0]})`);
check(held[1] === ROLE_SCREEN_MS, `period 2: ${ROLE_SCREEN_MS}ms (got ${held[1]})`);
check(held[2] === ROLE_SCREEN_FIRST_MS, `New day's first period: ${ROLE_SCREEN_FIRST_MS}ms again (got ${held[2]})`);

// …and a host crash in the middle of the long bell keeps it long. A crashed
// tab gets no pagehide save: it comes back from the save written as the
// bell's state went out (net.ts saves inside transport.local), not from a
// snapshot of the live engine.
{
  bells.length = 0;
  let live: HostEngine | null = null;
  let saved = "";
  const quiet: Transport = {
    toAll: (event, payload) => event === "state" && onBell((payload as { state: PublicState }).state),
    toPlayer: () => {},
    local: (event) => {
      if (event === "state" && live) saved = JSON.stringify(live.snapshot());
    },
  };
  const first = new HostEngine("BELLS", "Hana", "🎒", quiet, localOnlySource);
  live = first;
  for (let i = 0; i < 3; i++) first.addBot();
  void first.startMatch();
  await clock.runUntil(() => first.publicState().phase === "role", 500_000);
  await clock.runUntil(() => Date.now() >= bells[0].role + 1000, 500_000);
  const lastSave = saved;
  live = null;
  (first as unknown as { epoch: number }).epoch += 1000; // the old page is gone
  const second = HostEngine.restore(JSON.parse(lastSave), quiet, localOnlySource);
  await clock.runUntil(() => second.publicState().phase === "question", 500_000);
  check(bells[0].q1 - bells[0].role === ROLE_SCREEN_FIRST_MS, `a crash 1s into period 1's bell, back from the bell's own save, still starts question one at ${ROLE_SCREEN_FIRST_MS}ms (got ${bells[0].q1 - bells[0].role})`);
}
process.exit(failures ? 1 : 0);
