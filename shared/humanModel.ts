// How real people answer timed 4-option trivia, from
// design/research-human-quiz-behavior.md: shifted-lognormal response times
// (Kahoot-derived medians/σ), knowers faster than guessers, a rapid-guess
// component, last-second taps at the deadline, per-person ability and speed,
// per-question time intensity. Used by the simulator and by in-game bots.
import type { Tier } from "./protocol";

export type Accuracy = "low" | "mid" | "high";

export interface HumanModel {
  pKnow: Record<Accuracy, Record<Tier, number>>;
  knowMedianMs: Record<Tier, number>; // total RT incl. the shift
  guessMedianMs: Record<Tier, number>;
  shiftMs: number;
  knowSigma: number;
  guessSigma: number;
  rapidGuessShare: number; // of non-knowers
  rapidGuess: { median: number; sigma: number };
  guessAccuracy: number; // informed guessing beats 25%
  lastSecondTap: number; // P(tap a guess in the last 1.5s | would run out of time)
  abilitySd: number; // logit scale
  speedSd: number; // per-person log-speed
  itemIntensitySd: number; // per-question log time intensity (shared)
  distractorAlpha: number; // lower = wrong guesses converge on one distractor
  hostAdvanceRt: { median: number; sigma: number }; // talk time before the host taps Next
}

export const DEFAULT_HUMAN: HumanModel = {
  pKnow: {
    low: { easy: 0.65, medium: 0.3, hard: 0.08 },
    mid: { easy: 0.8, medium: 0.5, hard: 0.22 },
    high: { easy: 0.92, medium: 0.65, hard: 0.4 },
  },
  knowMedianMs: { easy: 3800, medium: 4500, hard: 5500 },
  guessMedianMs: { easy: 6500, medium: 7500, hard: 8500 },
  shiftMs: 1000,
  knowSigma: 0.5,
  guessSigma: 0.45,
  rapidGuessShare: 0.1,
  rapidGuess: { median: 2000, sigma: 0.3 },
  guessAccuracy: 0.28,
  lastSecondTap: 0.6,
  abilitySd: 0.8,
  speedSd: 0.25,
  itemIntensitySd: 0.2,
  distractorAlpha: 0.8,
  hostAdvanceRt: { median: 3000, sigma: 0.5 },
};

export function normal(rng: () => number): number {
  const u = Math.max(rng(), 1e-12);
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
export const lognormal = (rng: () => number, median: number, sigma: number) => median * Math.exp(sigma * normal(rng));
export const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));
export const logit = (p: number) => Math.log(p / (1 - p));

/** One person's answer to one question: whether they know it, and how long
 *  they take. `pace` = person speed + question intensity (log scale). */
export function sampleAnswer(
  rng: () => number,
  m: HumanModel,
  accuracy: Accuracy,
  tier: Tier,
  ability: number,
  pace: number,
): { knows: boolean; guessRight: boolean; rtMs: number } {
  const knows = rng() < sigmoid(logit(m.pKnow[accuracy][tier]) + ability);
  const shifted = (median: number, sigma: number) => m.shiftMs + (median - m.shiftMs) * Math.exp(sigma * normal(rng) + pace);
  if (knows) return { knows, guessRight: true, rtMs: shifted(m.knowMedianMs[tier], m.knowSigma) };
  const rapid = rng() < m.rapidGuessShare;
  const rtMs = rapid ? lognormal(rng, m.rapidGuess.median, m.rapidGuess.sigma) : shifted(m.guessMedianMs[tier], m.guessSigma);
  return { knows, guessRight: rng() < m.guessAccuracy, rtMs };
}
