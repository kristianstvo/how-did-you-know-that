# Changelog

Every version is a git tag. New work lives on the **`product-lead`** branch;
`main` stays at v0.2.0 (what was pushed to GitHub) until you decide to merge.
At most two versions per hour.

**Try a version**

```bash
git checkout v0.3.0          # any tag below (read-only look)
npm install                  # versions may add packages
npm run build && npm start   # http://localhost:3000
git checkout product-lead    # back to the newest
```

**Keep a version you like:** `git checkout product-lead && git reset --hard v0.3.0`
(later versions stay reachable through their tags), or put it on `main`:
`git checkout main && git merge v0.3.0`.

---

## v0.5.0 — Point at a suspect · 2026-10-20 00:58

**Why:** the north star is accusations happening on their own. Until now the
only way to say "I suspect you" on screen was to spend your one accusation, so
most players just watched. Pointing gives everyone a free, public, changeable
way to show suspicion. A pile of 👉 on one name is what makes someone raise a
hand.

**Added**
- 👉 next to ACCUSE on the reveal. It opens a bottom sheet of classmates
  (52px rows, with their exhibits and who already points at them); tap one to
  point. Your 👉 button then shows whom you point at, and "Stop pointing" takes
  it back.
- 👉 counts on the grade book and on the vote cards.
- Everyone may point, players in detention included (pointing is not a vote).
  The cheater can bluff-point.
- Bots point at their top suspect, so solo test rooms have a live pointer
  board.
- Pointers clear when their target goes to detention, and at every new match.
- Point events in the match log, to measure whether pointing leads to
  accusations.

**Changed**
- The ACCUSE confirm label is now "Sure? Tap again", so it fits beside 👉 on
  a 320px phone.
- How to play explains pointing.
- `tools/shot.mjs --click` taps an element before the screenshot.

**Evidence**
- 31 browser tests including a new pointing test, plus the protocol and relay
  checks.
- Parity has 0 differences, with pointers now in the recorded matches.
- Pointing never changes an outcome: the same seeds pick the same matches.

## v0.4.0 — Two strikes · 2026-10-20 00:12

**Why:** two balance problems, both measured. (1) A class could skip the whole
game: send everyone to detention in turn right after Q1 and catch the cheater
50–70% of the time with no deduction, because the falling line can't hurt a
cheater with no points yet. (2) At the old default line (1400) a cheater who
hides won 81–97% of simulated matches. Decision log: `PRODUCT.md`.

**Added**
- **Strikes:** every wrong detention is a strike. The **second strike makes the
  cheater graduate on the spot**, whatever the score. Shown everywhere it
  matters:
  - chalk strike boxes next to the grade book
  - "⚠ Last strike" on the vote screen
  - "✗ strike 1 of 2" on the detention stamp
  - its own ending, "Too many wrong detentions", with the fatal vote as the
    final blow
- A **Strikes** class rule for the host (0 turns it off), and a strikes chip for
  guests.
- `sim/tune-line.ts` picks the default line, and a new `struckout` replay
  fixture is parity-tested.

**Changed**
- **Default graduation line 1400 → 2100.**
- Bots and simulated players are more careful on the last strike.
- Rules text, specs 02/03 and the playtest checklist updated.

**Evidence**
- A cheater who hides wins 34–56% at 6 players (target 35–55%), 31–60% at 4
  or 8; obvious cheaters are caught (6–54%).
- The blind sweep now loses: the cheater wins 62–80% in rooms of 5–10.
- Deducing classes strike out in ≤3% of matches.
- 30/30 browser tests, protocol and relay checks pass; parity has 0
  differences across 5 matches.

## v0.3.0 — Phone play · 2026-10-19 23:55

**Why:** the game is played on phones, in hand, often on cellular, and a phone
that locks or drops signal ended the whole game. Measured first, at seven real
phone sizes (`10-phone-play.md`).

**Added**
- Host dropout recovery. The relay holds the room for 90s when the host's
  phone locks, switches apps or loses signal, holds the players' messages, and
  lets the host's phone take the room back.
- Connection banner ("Reconnecting… your seat is saved" / "The teacher's phone
  dropped out").
- Screen Wake Lock in a classroom.
- Automatic rejoin after a reload.
- A leave guard on the host's page.
- Scan-to-join QR in the lobby, next to Share invite.
- Phone-keyboard Go on the name and code fields.
- Landscape layouts for home, question and vote.

**Changed**
- Voting is pick, then **Hand in** (sticky, in thumb reach). A pick that is
  never handed in goes in 1.2s before the bell.
- You write your name directly on the "HELLO" sticker.
- Avatars become one swipeable row on short screens.
- Compact question and vote layouts on short screens.
- Larger answer times, vote chips, badges and markers.
- Android handwriting font: plain, not a joined-up script.

**Fixed**
- A fumbled double-tap on ACCUSE burned the token.
- Scroll carried across screens: the vote opened with the accuser and the
  timer off screen.
- iOS zoomed into the lobby's number fields.
- No double-tap zoom, no pull-to-refresh, and no long-press text selection on
  game controls.

**Tools**
- `tools/phone-audit.mjs` (7 phone sizes).
- `sim/relay-check.ts`.
- `tests/phone.spec.ts`.
- A 10-player fixture.
- `sim/circle.ts`, which plays the "accuse everyone in a circle" strategy
  against the real engine under candidate rules.

**Evidence**
- Primary controls hidden below the fold: 23 → 5 screen×phone cases.
- All 29 Playwright tests pass, plus the protocol and relay checks. Parity has
  0 differences.

## v0.2.0 — Game-show reveal · commit c7f5850

The reveal became a timed show synced across phones: pencils down, avatar
slaps, drumroll, answer, ✓/✗ with times, an evidence callout, grade book, then
ACCUSE. It also added one motion language, View Transitions, the case file,
CLEARED stamps, padded secrets and seat tokens, plus a seeded match simulator,
event-log export and parity / sync / performance / accessibility tests.
See `08-reveal-direction.md`.

## v0.1.0 — First playable · commit b943a2e

The school-themed social deduction quiz from specs 00–07, with bots, avatars,
side-by-side Join / Create, and 10 questions from 10 different subjects.
