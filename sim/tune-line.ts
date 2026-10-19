// Picks the default graduation line under the current rules (two strikes):
// cheater win rate by line, for careful/sprint cheaters (they hide) and
// naive/mimic ones (they don't), against score- and evidence-following rooms,
// plus the built-in bots. Target: 35–55% for a cheater who plays well.
// Usage: npx tsx sim/tune-line.ts [strikes=2] [lines=1400,1600,…]   → sim/out/tune-line.json
import { mkdirSync, writeFileSync } from "node:fs";
import { analyze } from "./analyze";
import { hashSeed, runScenario, VirtualClock, type Policy, type Scenario, type Strategy } from "./harness";

const STRIKES = Number(process.argv[2] ?? 2);
const LINES = process.argv[3] ? process.argv[3].split(",").map(Number) : [1400, 1600, 1800, 2000, 2200];
const MATCHES = 200;
const SEED = 20261020;
const clock = new VirtualClock();
clock.install();
mkdirSync(new URL("./out/", import.meta.url), { recursive: true });

type Cell = { line: number; n: number; policy: Policy | "bots"; strategy: Strategy; win: number; endQ: number; accuse: number };
const cells: Cell[] = [];
async function cell(line: number, n: number, policy: Policy | "bots", strategy: Strategy): Promise<number> {
  const sc: Scenario = {
    name: `t${line}-n${n}-${policy}-${strategy}`,
    players: n,
    accuracy: "mid",
    strategy,
    policy: policy === "bots" ? "score" : policy,
    matches: MATCHES,
    seed: hashSeed(SEED, n, policy),
    mode: policy === "bots" ? "builtinBots" : "clients",
    threshold: line,
    strikes: STRIKES,
  };
  const r = analyze((await runScenario(sc, clock)).records);
  cells.push({ line, n, policy, strategy, win: r.cheaterWinRate, endQ: r.endQuestion.mean, accuse: r.accusations.perMatch });
  return r.cheaterWinRate;
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
const range = (xs: number[]) => `${pct(Math.min(...xs))}–${pct(Math.max(...xs))}`;
for (const line of LINES) {
  const hide6: number[] = [];
  const show6: number[] = [];
  for (const policy of ["score", "scoreAware", "evidence"] as Policy[]) {
    for (const s of ["careful", "sprint"] as Strategy[]) hide6.push(await cell(line, 6, policy, s));
    for (const s of ["naive", "mimic"] as Strategy[]) show6.push(await cell(line, 6, policy, s));
  }
  const hide48: number[] = [];
  for (const n of [4, 8]) for (const policy of ["scoreAware", "evidence"] as Policy[]) for (const s of ["careful", "sprint"] as Strategy[]) hide48.push(await cell(line, n, policy, s));
  const bots: number[] = [];
  for (const n of [4, 6, 8]) bots.push(await cell(line, n, "bots", "mimic"));
  console.log(
    `line ${line} (strikes ${STRIKES}): hiding cheater 6p ${range(hide6)} · 4p/8p ${range(hide48)} · naive/mimic 6p ${range(show6)} · bots 4/6/8p ${bots.map(pct).join("/")}`,
  );
}
writeFileSync(new URL("./out/tune-line.json", import.meta.url), JSON.stringify({ strikes: STRIKES, cells }, null, 1));
