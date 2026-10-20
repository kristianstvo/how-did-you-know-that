// Playtest report: analyze the host's downloaded match logs (⬇ Download match
// log, JSONL) and set them beside the simulated bands for the same room size.
// Usage: npx tsx sim/report-logs.ts <log.jsonl> [more.jsonl ...]
import { existsSync, readFileSync } from "node:fs";
import type { MatchEvent } from "../shared/eventlog";
import { analyze, wilson, type MatchLog, type Report } from "./analyze";

const files = process.argv.slice(2);
if (!files.length) {
  console.error("usage: npx tsx sim/report-logs.ts <log.jsonl> [more.jsonl ...]");
  process.exit(2);
}

// Each file is one session export; split its events into matches. A host who
// downloads after every match exports the session-so-far each time, so
// matches are deduplicated on (room, match number), keeping the fullest copy.
const byKey = new Map<string, MatchEvent[]>();
for (const f of files) {
  let room = f;
  const local = new Map<number, MatchEvent[]>();
  for (const line of readFileSync(f, "utf8").split("\n")) {
    if (!line.trim()) continue;
    const e = JSON.parse(line) as MatchEvent | { type: "logHeader"; room?: string };
    if (e.type === "logHeader") {
      room = (e as { room?: string }).room ?? f;
      continue;
    }
    const m = (e as MatchEvent).match;
    local.set(m, [...(local.get(m) ?? []), e as MatchEvent]);
  }
  for (const [m, events] of local) {
    if (!events.some((e) => e.type === "matchEnd")) continue;
    const key = `${room}#${m}`;
    if ((byKey.get(key)?.length ?? 0) < events.length) byKey.set(key, events);
  }
}
const logs: MatchLog[] = [...byKey.values()].map((events) => ({ events }));
if (!logs.length) {
  console.error("No completed matches found in the logs.");
  process.exit(1);
}

const r = analyze(logs);
const sizes = logs.map((l) => (l.events.find((e) => e.type === "matchStart") as Extract<MatchEvent, { type: "matchStart" }>).players.length);
const avgSize = Math.round(sizes.reduce((a, b) => a + b, 0) / sizes.length);
const P = (x: number) => (Number.isFinite(x) ? `${(x * 100).toFixed(0)}%` : "—");

// Simulated bands for the closest simulated room size (4/6/8), across the
// room behaviours that accuse (score, scoreAware, evidence) and all cheater
// strategies — the range real rooms should fall into if the model is right.
let band = "";
const simFile = new URL("./out/report.json", import.meta.url);
if (existsSync(simFile)) {
  const sim = JSON.parse(readFileSync(simFile, "utf8")).reports as Record<string, { report: Report }>;
  const n = [4, 6, 8].reduce((a, b) => (Math.abs(b - avgSize) < Math.abs(a - avgSize) ? b : a));
  const cells = Object.entries(sim)
    .filter(([k]) => new RegExp(`^n${n}-mid-\\w+-(score|scoreAware|evidence)$`).test(k))
    .map(([, v]) => v.report);
  if (cells.length) {
    const range = (f: (x: Report) => number, fmt: (x: number) => string) => {
      const xs = cells.map(f).filter(Number.isFinite);
      return `${fmt(Math.min(...xs))}–${fmt(Math.max(...xs))}`;
    };
    band = `\nSimulated band (${n} players, accusing rooms, all cheater strategies; sim/out/report.json):
  cheater win rate          ${range((x) => x.cheaterWinRate, P)}
  accusations per match     ${range((x) => x.accusations.perMatch, (x) => x.toFixed(2))}
  first accusation (median) ${range((x) => x.accusations.firstAccuseQuestion.p50, (x) => `Q${x}`)}`;
  }
}

// v0.12: the features added since v0.3 — pointing (v0.5) and strikes (v0.4).
type Ev<T extends MatchEvent["type"]> = Extract<MatchEvent, { type: T }>;
let points = 0;
let pointers = 0; // distinct players who pointed at least once (summed over matches)
let seats = 0;
let accusedTop = 0; // banished player was the most-pointed-at classmate when the hand went up
let banishVotes = 0;
let finalAtCheater = 0;
let finalPointers = 0;
let struckOut = 0;
let wrongDetentions = 0;
for (const { events } of logs) {
  const start = events.find((e): e is Ev<"matchStart"> => e.type === "matchStart")!;
  const end = events.find((e): e is Ev<"matchEnd"> => e.type === "matchEnd")!;
  seats += start.players.length;
  const now = new Map<string, string | null>();
  const pointed = new Set<string>();
  let topAtAccuse: string[] = [];
  for (const e of events) {
    if (e.type === "point") {
      now.set(e.from, e.to);
      if (e.to) {
        points++;
        pointed.add(e.from);
      }
    } else if (e.type === "accuse") {
      const tally = new Map<string, number>();
      for (const to of now.values()) if (to) tally.set(to, (tally.get(to) ?? 0) + 1);
      const max = Math.max(0, ...tally.values());
      topAtAccuse = max ? [...tally].filter(([, n]) => n === max).map(([id]) => id) : [];
    } else if (e.type === "voteResult" && e.banishedId) {
      banishVotes++;
      if (topAtAccuse.includes(e.banishedId)) accusedTop++;
      if (!e.wasCheater) wrongDetentions++;
    }
  }
  pointers += pointed.size;
  for (const to of now.values()) {
    if (!to) continue;
    finalPointers++;
    if (to === end.cheaterId) finalAtCheater++;
  }
  if ((end as { struckOut?: boolean }).struckOut) struckOut++;
}
const featureLines = `
Pointing (v0.5)             ${(points / r.matches).toFixed(1)} points per match · ${P(pointers / seats)} of players pointed at least once
  pointers at the end       ${finalPointers ? `${P(finalAtCheater / finalPointers)} aimed at the cheater` : "none"}
  detentions vs pointing    ${banishVotes ? `${P(accusedTop / banishVotes)} of detentions went to the most-pointed-at classmate` : "no detentions"}
Strikes (v0.4)              ${(wrongDetentions / r.matches).toFixed(2)} wrong detentions per match · ${struckOut} match${struckOut === 1 ? "" : "es"} ended on strikes`;

const wins = Math.round(r.cheaterWinRate * r.matches);
const [lo, hi] = wilson(wins, r.matches);
console.log(`Playtest report — ${r.matches} matches from ${files.length} log file(s), ~${avgSize} players

Cheater win rate            ${P(r.cheaterWinRate)}  (95% CI ${P(lo)}–${P(hi)}; target 35–55%)
  outcomes                  ${Object.entries(r.outcomes).map(([k, v]) => `${k} ${v}`).join(", ")}
Accusations per match       ${r.accusations.perMatch.toFixed(2)}
Time to first accusation    median Q${r.accusations.firstAccuseQuestion.p50} · ${r.accusations.firstAccuseSeconds.p50?.toFixed(0) ?? "—"}s into the match · ${P(r.accusations.firstAccuseQuestion.none)} of matches had none
Votes                       cheater banished ${r.accusations.banishCheater}, innocent banished ${r.accusations.banishInnocent} (of whom provably CLEARED ${r.accusations.banishedProvablyInnocent}), ties ${r.accusations.tie}
Speed tell (AUC, med+hard)  ${r.speedTellAUC.mediumHard.toFixed(2)} (0.5 = cheater indistinguishable by speed)
Callouts per question       ${r.callouts.perQuestionSelected.toFixed(2)} (easy ${P(r.callouts.byTierSelected.easy)}, medium ${P(r.callouts.byTierSelected.medium)}, hard ${P(r.callouts.byTierSelected.hard)})
Match length (p50)          ${r.matchSeconds.p50.toFixed(0)}s${featureLines}${band}

With fewer than ~30 matches every rate has a wide CI — read the intervals, not the point estimates.`);
