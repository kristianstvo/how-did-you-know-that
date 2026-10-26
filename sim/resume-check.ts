// Engine check: the unkillable host (v0.14). Bot periods on the real engine
// (virtual clock). At each phase the host's page "reloads": the engine is
// rebuilt from a JSON round trip of its snapshot, the old one goes silent,
// and the new one must show exactly the same state and finish the period.
// Run: npx tsx sim/resume-check.ts
import { HostEngine, type Transport } from "../client/src/engine";
import { localOnlySource, resetLocalDeck } from "../client/src/providers";
import type { Phase } from "../shared/protocol";
import { mulberry32, VirtualClock } from "./harness";

const clock = new VirtualClock();
clock.install();
let failures = 0;
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? "✓" : "✗"} ${what}`);
  if (!ok) failures++;
};
const quiet: Transport = { toAll: () => {}, toPlayer: () => {}, local: () => {} };
type Inner = { epoch: number; botEpoch: number; cheaterId: string };

const AT: Phase[] = ["role", "question", "reveal", "vote", "voteResult", "matchEnd", "lobby"];
for (const at of AT) {
  let done = false;
  for (let seed = 1; seed <= 40 && !done; seed++) {
    clock.reset();
    resetLocalDeck();
    Math.random = mulberry32(seed * 7919);
    const first = new HostEngine("RESUM", "Hana", "🎒", quiet, localOnlySource);
    for (let i = 0; i < 5; i++) first.addBot();
    let live = first;
    let periods = 0; // "lobby" means back in homeroom after a period
    const tap = () => {
      live.advance();
      setTimeout(tap, 1000);
    };
    setTimeout(tap, 1000);
    void first.startMatch();
    const reached = () => {
      const p = first.publicState().phase;
      if (p === "matchEnd") periods = 1;
      return p === at && (at !== "lobby" || periods === 1);
    };
    // A vote needs a bot to accuse: try seeds until one does.
    try {
      await clock.runUntil(() => reached() || (at !== "matchEnd" && at !== "lobby" && first.publicState().phase === "matchEnd"), 500_000);
    } catch {
      continue;
    }
    if (!reached()) continue;
    done = true;

    const before = JSON.stringify(first.publicState());
    const json = JSON.stringify(first.snapshot());
    const cheater = (first as unknown as Inner).cheaterId;
    // The old page is gone: none of its timers may act any more.
    (first as unknown as Inner).epoch += 1000;
    (first as unknown as Inner).botEpoch += 1000;
    const second = HostEngine.restore(JSON.parse(json), quiet, localOnlySource);
    live = second;
    check(JSON.stringify(second.publicState()) === before, `${at}: the restored host shows exactly the same state (seed ${seed}, ${(json.length / 1024).toFixed(1)} KB)`);
    check((second as unknown as Inner).cheaterId === cheater, `${at}: …with the same cheater`);
    check(json.length < 64 * 1024, `${at}: the save stays small`);
    if (at === "lobby") {
      // Back in homeroom: the next period starts as usual.
      void second.startMatch();
      await clock.runUntil(() => second.publicState().phase === "question", 500_000);
      check(second.publicState().matchNumber === 2, `${at}: the next period starts (period 2)`);
      continue;
    }
    if (at === "matchEnd") {
      await clock.runUntil(() => second.publicState().phase === "lobby", 500_000);
      check(second.publicState().players.every((p) => !p.banished), `${at}: the host's tap takes the class back to homeroom`);
      continue;
    }
    let ok = true;
    try {
      await clock.runUntil(() => second.publicState().phase === "matchEnd" && !!second.publicState().match?.end, 500_000);
    } catch {
      ok = false;
    }
    const st = second.publicState();
    check(ok && !!st.match?.end, `${at}: the period plays on to its end (${st.match?.end?.reason ?? "stalled"} at Q${(st.match?.questionIdx ?? 0) + 1})`);
  }
  if (!done) check(false, `${at}: no seed reached this phase`);
}
// v0.18: a page that no longer hosts (its room closed, or another tab took
// it over) goes quiet: no timer acts, nothing is sent or saved.
{
  clock.reset();
  resetLocalDeck();
  Math.random = mulberry32(4242);
  let sent = 0;
  const counting: Transport = { toAll: () => sent++, toPlayer: () => sent++, local: () => sent++ };
  const e = new HostEngine("STOPD", "Hana", "🎒", counting, localOnlySource);
  for (let i = 0; i < 5; i++) e.addBot();
  void e.startMatch();
  await clock.runUntil(() => e.publicState().phase === "question", 500_000);
  e.stop();
  const before = sent;
  let done = false;
  setTimeout(() => (done = true), 60_000);
  await clock.runUntil(() => done, 500_000);
  check(sent === before && e.publicState().phase === "question", "a stopped host sends nothing and its timers don't move the game");
}
// v0.25: the report card's tomatoes and applause survive a host reload.
{
  clock.reset();
  resetLocalDeck();
  Math.random = mulberry32(2525);
  const e = new HostEngine("CHEER", "Hana", "🎒", quiet, localOnlySource);
  for (let i = 0; i < 5; i++) e.addBot();
  void e.startMatch();
  await clock.runUntil(() => e.publicState().phase === "question", 500_000);
  (e as unknown as { endMatch(r: string): void }).endMatch("top_score");
  let past = false;
  setTimeout(() => (past = true), 3000); // after the unmask (2.5s)
  await clock.runUntil(() => past, 500_000);
  e.localIntent({ kind: "cheer", what: "tomato" });
  let gap = false;
  setTimeout(() => (gap = true), 300);
  await clock.runUntil(() => gap, 500_000);
  e.localIntent({ kind: "cheer", what: "clap" });
  const json = JSON.stringify(e.snapshot());
  e.stop();
  const back = HostEngine.restore(JSON.parse(json), quiet, localOnlySource);
  const c = back.publicState().match?.end?.cheers;
  check(c?.tomato === 1 && c?.clap === 1, `matchEnd: the cheers survive a host reload (🍅 ${c?.tomato} · 👏 ${c?.clap})`);
}
process.exit(failures ? 1 : 0);
