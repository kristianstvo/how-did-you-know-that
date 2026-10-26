# 01 — Match Loop

## Match structure
One match = 10 questions, one secret cheater, ends by one of three conditions (see 04).

| Difficulty | Points |
|---|---|
| easy | 100 |
| medium | 200 |
| hard | 400 |

**v0.26 — grading on a curve.** The class sets the difficulty. Q1 is medium.
When everyone gets a question right, the next is one tier harder; when
nobody does, one tier easier; otherwise it stays (it stops at easy and hard).
A phone away at the bell without an answer doesn't count. Until v0.25 the
ramp was fixed: Q1–Q3 easy, Q4–Q7 medium, Q8–Q10 hard (max 2300).

A period on medium is worth 2000 to someone who never misses, so the default
graduation line is **2000** (was 2100; sim/tune-line.ts). All values are
lobby-configurable; these are defaults.

## State machine (host-authoritative)

```
LOBBY
  └─ host starts match → CHEATER_ASSIGN (silent, see 02)
QUESTION(n)                 [15s timer]
  └─ all answered OR timer → REVEAL(n)
REVEAL(n)                   [min 8s; host taps Next to advance]
  ├─ token burned → VOTE (see 03)
  │     ├─ cheater banished → MATCH_END(innocents_win)
  │     └─ otherwise → back to REVEAL(n) resolution → next
  ├─ cheater score ≥ threshold → MATCH_END(cheater_win)   [checked on score update]
  └─ n == 10 → MATCH_END(top_score)
  └─ else → QUESTION(n+1)
MATCH_END → MATCH_SUMMARY → LOBBY (next match) or SESSION_END
```

## QUESTION phase
- Question text + 4 shuffled options, identical order for all players.
- 15s countdown, visible to all.
- No answer submitted when timer expires = wrong, scored 0, recorded as "no answer".
- Answer time is recorded from question display to tap, per player.
- Answers are locked once tapped; no changes.

## REVEAL phase — the deduction fuel
Shown to everyone, every question, full transparency:
- Correct answer highlighted.
- Every player's pick, correct/wrong, and **answer time to 0.1s**.
- Updated leaderboard with the cheater threshold line drawn on it (see 02).
- Accusation button (token) is active **only during this phase** (see 03).
- Minimum 8s on screen so accusations have room to happen; host advances manually after that.

## Threshold instant-win
The threshold check fires the moment scores update after a reveal. If the cheater crosses it, the match ends **immediately and loudly** — dedicated takeover screen, cheater identity revealed (see 07).

## Timing defaults (lobby-configurable)
- Question timer: 15s
- Reveal minimum: 8s
- Vote casting window: 20s (see 03)
