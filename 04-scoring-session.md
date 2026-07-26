# 04 — Scoring & Session

## In-match quiz scoring
- Correct answer: full tier value (100/200/400 per 01). Wrong or no answer: 0.
- No speed bonus. Answer times are displayed as **social information only** — they influence accusations, not scores. (Locked decision; keeps the cheater's speed-tell meaningful without letting them snowball.)

## Match end conditions (exactly one fires)
| # | Condition | Match winner(s) |
|---|---|---|
| 1 | Cheater banished by vote | Innocents (collectively) |
| 2 | Cheater score ≥ threshold | Cheater, instantly |
| 3 | Q10 completes, neither above | **Highest quiz scorer, role irrelevant** — an innocent, a banished innocent, or even the surviving under-threshold cheater |

Quiz-score tie at Q10: shared match win.

## Session
- A session is the same lobby playing repeated matches. New cheater rolled randomly each match (02).
- Session leaderboard persists across matches (in host memory only — dies with the session, per 00 non-goals).

## Session points (PROPOSED DEFAULTS — first thing to tune after playtests)
| Event | Session points |
|---|---|
| You voted for the cheater in the banishing vote | +2 |
| You triggered the vote that banished the cheater | +1 (bonus, stacks) |
| You are the cheater and hit the threshold | +3 |
| You win the match on Q10 top score | +2 |
| You are the cheater and survive to Q10 (even if not top score) | +1 |
| You voted to banish an innocent | −1 |

Rationale: catching the cheater pays best collectively; a threshold win pays the cheater best individually; wrong votes sting personally on top of the threshold drop.

## Session end
- No fixed length. Host ends the session from the lobby; final leaderboard screen shown (07).
- Suggested soft default displayed to host: "play at least one match per player" so everyone likely cheats once — but selection stays random (locked decision).

## Config knobs
- All session point values above, as a single editable table in lobby settings (v1: can ship hardcoded, table structure ready).
