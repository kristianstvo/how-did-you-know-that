// Engine check: Practice as (v0.11). Run: npx tsx sim/practice-check.ts
//   · a practice room (everyone else is a bot) deals the host the role they chose
//   · any room with another human ignores the choice: uniform as always
import { cheaterPool, HostEngine, type Transport } from "../client/src/engine";
import { localOnlySource, resetLocalDeck } from "../client/src/providers";
import { VirtualClock } from "./harness";

let failures = 0;
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? "✓" : "✗"} ${what}`);
  if (!ok) failures++;
};
const H = { id: "h", isHost: true, isBot: false };
const bots = [1, 2, 3].map((i) => ({ id: `b${i}`, isHost: false, isBot: true }));
const human = { id: "x", isHost: false, isBot: false };
const ids = (ps: { id: string }[]) => ps.map((p) => p.id).join(",");

check(ids(cheaterPool([H, ...bots], "cheater")) === "h", "practice room, Cheater: only the host can be dealt it");
check(ids(cheaterPool([H, ...bots], "innocent")) === "b1,b2,b3", "practice room, Innocent: only bots can be dealt it");
check(ids(cheaterPool([H, ...bots], "random")) === "h,b1,b2,b3", "practice room, Random: everyone");
check(ids(cheaterPool([H, human, ...bots], "cheater")) === "h,x,b1,b2,b3", "another human present: the choice is ignored");
check(ids(cheaterPool([H, human], "innocent")) === "h,x", "…in any room with people");

// A real practice match: the host chose Cheater.
const clock = new VirtualClock();
clock.install();
resetLocalDeck();
const transport: Transport = { toAll: () => {}, toPlayer: () => {}, local: () => {} };
const engine = new HostEngine("PRACT", "Solo", "🎒", transport, localOnlySource);
for (let i = 0; i < 3; i++) engine.addBot();
engine.updateSettings({ practiceRole: "cheater" });
void engine.startMatch();
await clock.runUntil(() => engine.publicState().phase === "question");
const cheaterId = (engine as unknown as { cheaterId: string }).cheaterId;
check(cheaterId === engine.hostPlayer.id, "a real practice match deals the host the cheater");
process.exit(failures ? 1 : 0);
