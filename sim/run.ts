// Runs the simulation suites, writes per-scenario event logs (JSONL) and a
// combined report. Usage: npx tsx sim/run.ts [suite ...]   (default: all)
import { mkdirSync, writeFileSync } from "node:fs";
import { analyze, type Report } from "./analyze";
import { hashSeed, mulberry32, runScenario, VirtualClock, type Accuracy, type Policy, type Scenario, type Strategy } from "./harness";

const OUT = new URL("./out/", import.meta.url);
const LOGS = new URL("./logs/", OUT);
mkdirSync(LOGS, { recursive: true });

const STRATEGIES: Strategy[] = ["naive", "mimic", "careful", "sprint"];
const MATCHES = 200;
const SEED = 20261018;

function cell(players: number, accuracy: Accuracy, strategy: Strategy, policy: Policy, mode: Scenario["mode"] = "clients", threshold?: number): Scenario {
  const base = mode === "builtinBots" ? `builtin-n${players}` : `n${players}-${accuracy}-${strategy}-${policy}`;
  const name = threshold ? `${base}-t${threshold}` : base;
  return { name, players, accuracy, strategy, policy, matches: MATCHES, seed: hashSeed(SEED, players), mode, threshold };
}

const SUITES: Record<string, () => Scenario[]> = {
  core: () => STRATEGIES.map((s) => cell(6, "mid", s, "none")),
  players: () => [4, 8].flatMap((n) => STRATEGIES.map((s) => cell(n, "mid", s, "none"))),
  accuracy: () => (["low", "high"] as Accuracy[]).flatMap((a) => STRATEGIES.map((s) => cell(6, a, s, "none"))),
  balance: () => [4, 6, 8].flatMap((n) => (["score", "scoreAware", "evidence"] as Policy[]).flatMap((p) => STRATEGIES.map((s) => cell(n, "mid", s, p)))),
  builtin: () => [4, 6, 8].map((n) => cell(n, "mid", "mimic", "score", "builtinBots")),
  threshold: () =>
    [1600, 1800, 2000].flatMap((t) => (["score", "scoreAware", "evidence"] as Policy[]).flatMap((p) => STRATEGIES.map((s) => cell(6, "mid", s, p, "clients", t)))),
};

// v0.26: the offline fallback's "every slot keeps its ramp tier" study is
// gone with the ramp: questions are drawn one at a time at the tier the class
// earned, and sim/pack-check.ts proves every draw keeps it.

const requested = process.argv.slice(2);
const suites = requested.length ? requested : Object.keys(SUITES);
const clock = new VirtualClock();
clock.install();

const reports: Record<string, { scenario: Scenario; report: Report; integrity: unknown }> = {};
const t0 = performance.now();
for (const suite of suites) {
  for (const sc of SUITES[suite]()) {
    if (reports[sc.name]) continue;
    const res = await runScenario(sc, clock);
    writeFileSync(new URL(`${sc.name}.jsonl`, LOGS), res.records.map((r) => JSON.stringify(r)).join("\n") + "\n");
    reports[sc.name] = { scenario: sc, report: analyze(res.records, sc.evidence), integrity: res.integrity };
    const r = reports[sc.name].report;
    console.log(
      `${sc.name.padEnd(28)} win ${(r.cheaterWinRate * 100).toFixed(0).padStart(3)}%  endQ ${r.endQuestion.mean.toFixed(1)}  callouts/q ${r.callouts.perQuestionSelected.toFixed(2)}  accuse/m ${r.accusations.perMatch.toFixed(2)}  integrity ${JSON.stringify(res.integrity)}`,
    );
  }
}
writeFileSync(new URL("report.json", OUT), JSON.stringify({ reports }, null, 1));
console.log(`done in ${((performance.now() - t0) / 1000).toFixed(1)}s → sim/out/report.json`);
