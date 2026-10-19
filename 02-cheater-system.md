# 02 — Cheater System

## Selection
- One cheater per match, chosen **uniformly at random** by the host client at match start. No memory of previous matches (same player can repeat — that's part of the fun).
- Delivered via a private message to that player only (see 05). All players get a "roles assigned" screen that looks identical, so nobody can be identified by screen behavior.

## What the cheater knows
- The correct answer to **every question**, shown at the same moment the question appears.
- Their current distance to the threshold (same info everyone has — it's public).

## What the cheater does NOT get
- No extra powers, no immunity, no vote weight. They vote in banishment votes like everyone else (abstaining would expose them).

## Answer delivery UX (see also 07)
- The correct option is marked with a **subtle indicator** (e.g., a slightly thicker border or a faint dot), not a bright highlight. Layout is pixel-identical to the innocent view.
- Rationale: reduces accidental exposure via screen-share or shoulder-surfing. Accepted residual risk noted in 00.

## Threshold
- **Public at all times.** Rendered as a line on the leaderboard: "Cheater wins at 2100."
- Default: **2100** (of 2300 max — the cheater must be nearly perfect, which is exactly what looks suspicious). *v0.4: raised from 1400. Under the strike rule below, a cheater who hides won 81–97% of simulated matches at 1400 and 34–56% at 2100 (`sim/tune-line.ts`); the target is 35–55%.*
- Every wrong banishment **drops the threshold by 200, publicly and dramatically** ("Cheater now needs 1000!"). This is the penalty mechanism: reckless accusations directly accelerate the cheater.
- The drop applies to the threshold, never to the cheater's visible score — adding secret points to the leaderboard would identify them.
- **Strikes (v0.4):** every wrong banishment is also a strike. At the strike limit (default **2**) the cheater graduates on the spot, whatever their score. Without it, sending everyone to detention in turn right after Q1 caught the cheater 50–70% of the time with no deduction at all, because the falling line can't hurt a cheater who has no points yet (`sim/circle.ts`). With two strikes that blind sweep becomes a losing move (the cheater wins 62–80% in rooms of 5–10), while classes that deduce rarely strike out (≤3% of matches).

## Win check
- After every score update: if `cheaterScore >= currentThreshold` → instant match end, full reveal (01, 04).
- After a wrong banishment: if wrong banishments reach the strike limit → the same instant graduation (v0.4).

## Design intent (for future tuning)
The cheater's dilemma must stay intact: easy questions are cover, hard questions are temptation. If playtests show cheaters winning too often, raise the threshold or shrink the drop — never remove the public threshold, it is the game's tension meter.

## Config knobs (lobby settings)
- `threshold` (default 1400)
- `thresholdDropPerWrongBanish` (default 200)
