import { runScenario, VirtualClock } from "./harness";

const clock = new VirtualClock();
clock.install();
const t0 = performance.now();
for (const mode of ["clients", "builtinBots"] as const) {
  const res = await runScenario(
    { name: `smoke-${mode}`, players: 5, accuracy: "mid", strategy: "mimic", policy: "evidence", matches: 5, seed: 1, mode },
    clock,
  );
  for (const r of res.records) {
    const end = r.events.find((e) => e.type === "matchEnd");
    const counts: Record<string, number> = {};
    for (const e of r.events) counts[e.type] = (counts[e.type] ?? 0) + 1;
    console.log(mode, r.matchIndex, end && "reason" in end ? `${end.reason} @Q${end.q + 1}` : "NO END", JSON.stringify(counts));
  }
  console.log("integrity", JSON.stringify(res.integrity));
}
console.log(`elapsed ${(performance.now() - t0).toFixed(0)}ms`);
