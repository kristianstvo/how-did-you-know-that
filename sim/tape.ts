// Generates replay fixtures (client/public/fixtures/*.json): seeded matches,
// recorded state-by-state from the real engine, picked for the moments worth
// reproducing. Usage: npx tsx sim/tape.ts [name ...]   (default: all)
import { mkdirSync, writeFileSync } from "node:fs";
import { matchEndTimeline } from "../shared/choreo";
import type { MatchEvent } from "../shared/eventlog";
import { hashSeed, runScenario, VirtualClock, type MatchRecord, type Scenario } from "./harness";

type Ev<T extends MatchEvent["type"]> = Extract<MatchEvent, { type: T }>;
const OUT = new URL("../client/public/fixtures/", import.meta.url);
mkdirSync(OUT, { recursive: true });

const NAMES = ["Kiko", "Maya", "Sam", "Priya", "Leo", "Ana"];
// A full class with the longest names the name tag allows (20 characters):
// the worst case for fitting a phone screen.
const FULL_CLASS = ["Kiko", "Maya", "Sam", "Priya", "Leo", "Ana", "Maximilian", "Zoë", "Alexandrina Charlott", "Jo"];
const clock = new VirtualClock();
clock.install();

const endOf = (r: MatchRecord) => r.events.find((e): e is Ev<"matchEnd"> => e.type === "matchEnd")!;
const votes = (r: MatchRecord) => r.events.filter((e): e is Ev<"voteResult"> => e.type === "voteResult");
const reveals = (r: MatchRecord) => r.events.filter((e): e is Ev<"reveal"> => e.type === "reveal" && !e.final);
/** v0.26: the class moved the difficulty at least once (a stamped question). */
const curved = (r: MatchRecord) => !!r.tape?.frames.some((f) => f.state.match?.question?.shift);
/** A reveal rang the last bell (the a11y and layout checks need one). */
const rang = (r: MatchRecord) => !!r.tape?.frames.some((f) => f.state.phase === "reveal" && !!f.state.match?.reveal?.lastBell.length);

interface Want {
  name: string;
  description: string;
  strategy: Scenario["strategy"];
  policy: Scenario["policy"];
  threshold?: number;
  names?: string[];
  test: (r: MatchRecord) => boolean;
}

const WANTS: Want[] = [
  {
    name: "caught",
    description: "The class catches the cheater late, after a tense Act III.",
    strategy: "mimic",
    policy: "evidence",
    test: (r) => endOf(r).reason === "cheater_banished" && endOf(r).q >= 5,
  },
  {
    name: "graduated",
    description: "A wrong detention drops the line, then the cheater graduates.",
    strategy: "careful",
    policy: "score",
    test: (r) => endOf(r).reason === "cheater_threshold" && votes(r).some((v) => v.newThreshold !== null),
  },
  {
    name: "topscore",
    description: "Nobody graduates; top of the class takes it at Q10, and the class moves the difficulty.",
    strategy: "careful",
    policy: "scoreAware",
    test: (r) => endOf(r).reason === "top_score" && reveals(r).length === 10 && curved(r),
  },
  {
    name: "struckout",
    description: "Two wrong detentions: the cheater graduates on strikes.",
    strategy: "careful",
    policy: "score",
    test: (r) => !!endOf(r).struckOut,
  },
  {
    name: "detention",
    description: "An innocent goes to detention mid-match; the match continues.",
    strategy: "sprint",
    policy: "score",
    test: (r) => votes(r).some((v) => v.banishedId && !v.wasCheater) && endOf(r).q >= 7 && rang(r),
  },
  {
    name: "fullclass",
    description: "Ten classmates, long names, a wrong detention: the phone-layout worst case.",
    strategy: "careful",
    policy: "score",
    names: FULL_CLASS,
    test: (r) => votes(r).some((v) => v.banishedId && !v.wasCheater) && endOf(r).q >= 6,
  },
];

const only = process.argv.slice(2);

for (const want of WANTS.filter((w) => !only.length || only.includes(w.name))) {
  let found: MatchRecord | null = null;
  for (let batch = 0; batch < 20 && !found; batch++) {
    const sc: Scenario = {
      name: `tape-${want.name}`,
      players: want.names?.length ?? 6,
      accuracy: "mid",
      strategy: want.strategy,
      policy: want.policy,
      matches: 25,
      seed: hashSeed("tape", want.name, batch),
      mode: "clients",
      questionSource: "local",
      names: want.names ?? NAMES,
      record: true,
      threshold: want.threshold,
    };
    const res = await runScenario(sc, clock);
    found = res.records.find(want.test) ?? null;
  }
  if (!found || !found.tape) {
    console.log(`✗ ${want.name}: no match found`);
    continue;
  }
  const { frames, secrets, players } = found.tape;
  // The room fills and the bell rings in the same virtual instant; give the
  // lobby 2.5s of its own before the role screen (playhead 0) so it can be
  // replayed (?t=-1500). Lobby states carry no beat timing, so moving their
  // delivery time is safe.
  const roleIdx = frames.findIndex((f) => f.state.phase === "role");
  const t0 = frames[roleIdx].t;
  frames.slice(0, roleIdx).forEach((f, i) => (f.t = t0 - 2500 + i));
  const endFrame = frames[frames.length - 1];
  const reason = endFrame.state.match!.end!.reason;
  const durationMs = endFrame.t - t0 + matchEndTimeline(reason).end + 3000;
  const cheaterId = endFrame.state.match!.end!.cheaterId;
  const tape = { name: want.name, description: want.description, seed: found.seed, t0, durationMs, cheaterId, players, frames, secrets };
  writeFileSync(new URL(`${want.name}.json`, OUT), JSON.stringify(tape));
  const cheaterName = players.find((p) => p.id === cheaterId)?.name;
  console.log(`✓ ${want.name}: seed ${found.seed}, ${frames.length} frames, ${(durationMs / 1000).toFixed(0)}s, cheater ${cheaterName}, ends ${reason} @Q${endFrame.state.match!.questionIdx + 1}`);
}
