// Same scenario + seed must give byte-identical logs, even with other
// scenarios run in between. Usage: npx tsx sim/determinism.ts
import { runScenario, VirtualClock, type Scenario } from "./harness";

const clock = new VirtualClock();
clock.install();
const sc = (policy: Scenario["policy"], strategy: Scenario["strategy"]): Scenario => ({
  name: `det-${policy}-${strategy}`, players: 6, accuracy: "mid", strategy, policy, matches: 40, seed: 7, mode: "clients",
});
const a = JSON.stringify((await runScenario(sc("evidence", "sprint"), clock)).records);
await runScenario(sc("score", "naive"), clock); // disturb process-wide state
const b = JSON.stringify((await runScenario(sc("evidence", "sprint"), clock)).records);
console.log(a === b ? "DETERMINISTIC: identical logs" : "NON-DETERMINISTIC: logs differ");

// Paired answering: innocents' answers are identical across cheater strategies.
const answers = (recs: Awaited<ReturnType<typeof runScenario>>["records"]) =>
  recs.map((r) => {
    const end = r.events.find((e) => e.type === "matchEnd") as { cheaterId: string } | undefined;
    const q1 = r.events.find((e) => e.type === "reveal" && e.q === 0) as { rows: { playerId: string; pick: number; timeMs: number }[] } | undefined;
    return JSON.stringify(q1?.rows.filter((row) => row.playerId !== end?.cheaterId));
  });
const x = answers((await runScenario(sc("none", "naive"), clock)).records);
const y = answers((await runScenario(sc("none", "careful"), clock)).records);
const same = x.filter((v, i) => v === y[i]).length;
console.log(`paired innocent Q1 answers identical across strategies: ${same}/${x.length}`);
process.exit(a === b && same === x.length ? 0 : 1);
