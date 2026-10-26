// Content check: the curated question pack (client/src/localPack.ts).
// Run: npx tsx sim/pack-check.ts
//   · every question has a valid tier and school subject
//   · exactly three wrong answers, all different, none equal to the right one
//   · every question fits a phone: text ≤ 90 characters, options ≤ 32 (v0.26)
//   · no question appears twice
//   · every subject has enough of every tier that a full period never repeats
//   · sessions of 5 periods draw no repeats while the pack lasts
import { QUESTIONS_PER_MATCH, SUBJECTS, type Tier } from "../shared/protocol";
import { LOCAL_PACK } from "../client/src/localPack";
import { localOnlySource, resetLocalDeck } from "../client/src/providers";

let failures = 0;
const check = (ok: boolean, what: string, detail = "") => {
  console.log(`${ok ? "✓" : "✗"} ${what}${!ok && detail ? `: ${detail}` : ""}`);
  if (!ok) failures++;
};

const subjects = new Set<string>(SUBJECTS.map((s) => s.label));
const tiers = new Set(["easy", "medium", "hard"]);
const bad = LOCAL_PACK.filter((q) => !tiers.has(q.tier) || !subjects.has(q.subject));
check(!bad.length, `${LOCAL_PACK.length} questions, every tier and subject valid`, bad.map((q) => q.text).join(" | "));

const badAnswers = LOCAL_PACK.filter((q) => {
  const all = [q.correct, ...q.incorrect].map((x) => x.trim().toLowerCase());
  return q.incorrect.length !== 3 || new Set(all).size !== 4 || all.some((x) => !x);
});
check(!badAnswers.length, "three distinct wrong answers, none equal to the right one", badAnswers.map((q) => q.text).join(" | "));

const tooLong = LOCAL_PACK.filter((q) => q.text.length > 90 || [q.correct, ...q.incorrect].some((o) => o.length > 32));
check(!tooLong.length, "every question fits a phone: text ≤ 90 characters, options ≤ 32", tooLong.map((q) => q.text).join(" | "));

const seen = new Map<string, number>();
for (const q of LOCAL_PACK) seen.set(q.text.trim().toLowerCase(), (seen.get(q.text.trim().toLowerCase()) ?? 0) + 1);
const dups = [...seen].filter(([, n]) => n > 1).map(([t]) => t);
check(!dups.length, "no question appears twice", dups.join(" | "));

const thin: string[] = [];
for (const s of subjects) for (const t of tiers) if (LOCAL_PACK.filter((q) => q.subject === s && q.tier === t).length < 4) thin.push(`${s}/${t}`);
check(!thin.length, "every subject has at least 4 questions of every tier", thin.join(", "));

// A session played entirely offline (v0.26: drawn one at a time, at the
// tier the class earned): five periods on a typical curve without a repeat.
Object.assign(globalThis, { document: { createElement: () => ({ innerHTML: "", value: "" }) } });
const CURVE: Tier[] = ["medium", "medium", "hard", "hard", "hard", "medium", "medium", "easy", "medium", "medium"];
resetLocalDeck();
const used = new Set<string>();
let repeats = 0;
let tierSlips = 0;
let subjectRepeats = 0;
for (let period = 0; period < 5; period++) {
  localOnlySource.start();
  const subjectsThisPeriod = new Set<string>();
  for (const tier of CURVE.slice(0, QUESTIONS_PER_MATCH)) {
    const q = localOnlySource.next(tier);
    if (used.has(q.text)) repeats++;
    used.add(q.text);
    if (q.tier !== tier) tierSlips++;
    if (subjectsThisPeriod.has(q.subject)) subjectRepeats++;
    subjectsThisPeriod.add(q.subject);
  }
}
check(repeats === 0, "5 offline periods in a row: no repeated question", `${repeats} repeats`);
check(tierSlips === 0, "…and every draw keeps the tier the class earned", `${tierSlips} slips`);
check(subjectRepeats === 0, "…and no subject twice in a period", `${subjectRepeats} repeats`);

// The curve mostly stays near medium: a long night of medium-only periods
// still finds a fresh medium question every time.
resetLocalDeck();
const medium = new Set<string>();
let mediumRepeats = 0;
const MEDIUM_PERIODS = 8;
for (let period = 0; period < MEDIUM_PERIODS; period++) {
  localOnlySource.start();
  for (let i = 0; i < QUESTIONS_PER_MATCH; i++) {
    const q = localOnlySource.next("medium");
    if (medium.has(q.text)) mediumRepeats++;
    medium.add(q.text);
  }
}
check(mediumRepeats === 0, `${MEDIUM_PERIODS} periods all on medium: no repeated question`, `${mediumRepeats} repeats`);
process.exit(failures ? 1 : 0);
