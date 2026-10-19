// Stress test: what if the class ignores the evidence and just sends
// everyone to detention in turn until the cheater is caught? Runs that sweep
// against the real engine under the shipped rules and under candidate rule
// fixes, then checks what each fix does to normal (evidence-driven) play.
// Usage: npx tsx sim/circle.ts            → sim/out/circle.json
import { mkdirSync, writeFileSync } from "node:fs";
import { analyze, type Report } from "./analyze";
import { hashSeed, runScenario, VirtualClock, type Policy, type RuleVariant, type Scenario, type Strategy } from "./harness";

const OUT = new URL("./out/", import.meta.url);
mkdirSync(OUT, { recursive: true });

const MATCHES = 200;
const SEED = 20261019;
const STRATEGIES: Strategy[] = ["naive", "mimic", "careful", "sprint"];
const SIZES = [4, 5, 6, 8, 10];
const STARTS = [0, 3, 6]; // sweep begins in the reveal after Q1, Q4, Q7

// "current" here means the rules before v0.4 (no strike-out); v0.4 shipped
// strikes2 as the default.
const RULES: Record<string, { rules?: RuleVariant; strikes: number }> = {
  current: { strikes: 0 },
  onePerReveal: { rules: { onePerReveal: true }, strikes: 0 },
  onePerRevealFromQ4: { rules: { onePerReveal: true, accuseFromQ: 3 }, strikes: 0 },
  strikes2: { strikes: 2 },
};

interface Row {
  rule: string;
  policy: Policy;
  start: number;
  players: number;
  strategy: Strategy;
  threshold: number;
  cheaterWin: number;
  ci: [number, number];
  endQ: number;
  endedByQ2: number; // share of matches over before the quiz really started
  wrongPerMatch: number;
  ties: number;
}

const clock = new VirtualClock();
clock.install();
const rows: Row[] = [];
const t0 = performance.now();

async function run(sc: Scenario, rule: string, start: number): Promise<Report> {
  const r = analyze((await runScenario(sc, clock)).records, sc.evidence);
  const early = Object.entries(r.endQuestion.hist).reduce((n, [q, c]) => n + (Number(q) <= 2 ? c : 0), 0);
  rows.push({
    rule,
    policy: sc.policy,
    start,
    players: sc.players,
    strategy: sc.strategy,
    threshold: sc.threshold ?? 1400,
    cheaterWin: r.cheaterWinRate,
    ci: r.cheaterWinCI,
    endQ: r.endQuestion.mean,
    endedByQ2: early / r.matches,
    wrongPerMatch: r.accusations.banishInnocent / r.matches,
    ties: r.accusations.tie / r.matches,
  });
  return r;
}

const pct = (x: number) => `${Math.round(x * 100)}%`.padStart(4);

// 1. The sweep, every rule × policy × start × room size × cheater strategy.
for (const [rule, { rules, strikes }] of Object.entries(RULES)) {
  for (const policy of ["circle", "circleInformed"] as Policy[]) {
    for (const start of STARTS) {
      const line: string[] = [];
      for (const n of SIZES) {
        const wins: number[] = [];
        for (const strategy of STRATEGIES) {
          // Same seed per room size across rules, starts and policies: paired comparisons.
          const sc: Scenario = { name: `${rule}-${policy}-q${start + 1}-n${n}-${strategy}`, players: n, accuracy: "mid", strategy, policy, matches: MATCHES, seed: hashSeed(SEED, n), mode: "clients", sweepFrom: start, rules, strikes };
          wins.push((await run(sc, rule, start)).cheaterWinRate);
        }
        line.push(`${n}p ${pct(Math.max(...wins))}`);
      }
      console.log(`${rule.padEnd(19)} ${policy.padEnd(15)} from Q${start + 1}: cheater's best ${line.join("  ")}`);
    }
  }
}

// 2. Normal play under each rule: does the fix hurt honest deduction?
for (const [rule, { rules, strikes }] of Object.entries(RULES)) {
  for (const threshold of [1400, 2000]) {
    const out: string[] = [];
    for (const policy of ["scoreAware", "evidence"] as Policy[]) {
      for (const strategy of STRATEGIES) {
        const sc: Scenario = { name: `${rule}-normal-${policy}-n6-${strategy}-t${threshold}`, players: 6, accuracy: "mid", strategy, policy, matches: MATCHES, seed: hashSeed(SEED, 6, "normal"), mode: "clients", threshold, rules, strikes };
        out.push(`${policy[0]}/${strategy} ${pct((await run(sc, rule, -1)).cheaterWinRate)}`);
      }
    }
    for (const n of [4, 6, 8]) {
      const sc: Scenario = { name: `${rule}-bots-n${n}-t${threshold}`, players: n, accuracy: "mid", strategy: "mimic", policy: "score", matches: MATCHES, seed: hashSeed(SEED, n, "bots"), mode: "builtinBots", threshold, rules, strikes };
      out.push(`bots${n} ${pct((await run(sc, rule, -1)).cheaterWinRate)}`);
    }
    console.log(`${rule.padEnd(19)} normal play, line ${threshold}: ${out.join("  ")}`);
  }
}

writeFileSync(new URL("circle.json", OUT), JSON.stringify(rows, null, 1));
console.log(`done in ${((performance.now() - t0) / 1000).toFixed(0)}s → sim/out/circle.json (${rows.length} scenarios)`);
