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

## v0.10.0 — Hosting made easy · 2026-10-20 03:13

**Why:** the teacher runs the night from a phone. Typing seconds into a number
field to change the pace was fiddly, and the balance numbers (line, drop,
strikes) looked like homework next to it. A group that wanted to keep playing
after "End the day" had to make a new room and rejoin with a new code. And a
friend who left for good stayed on the roster forever as "reconnecting".

**Added**
- **Pace presets:** ⚡ Quick (10s), 🎓 Classic (15s), 🧘 Relaxed (25s). Big
  buttons, and every phone's rules chips update.
- **Advanced:** the line, drop, strikes and a custom timer, folded under one
  row that summarizes them ("line 2100 · −200 · 2 strikes").
- **🔁 New day, same class** at session end, for the host: back to homeroom
  with fresh standings, same room, same code, nobody rejoins. Players see
  "Stay here if the teacher starts a new day".
- **Clear a seat:** between periods the host can remove a classmate who left
  for good (disconnected), just like a bot. Never someone still here, never
  the host.

**Evidence**
- Engine checks: New day resets the standings and keeps the class.
- Removing works only for someone who left.
- A phone test sets the pace in one tap and sees it on a guest's phone.
- The full suite passes.

## v0.9.0 — Question bank 2.0 · 2026-10-20 02:58

**Why:** a quiz game lives on its questions.
- The curated school pack had 86 questions, skewed to Science and Geography
  (Film Studies and Civics had three each), so offline periods started
  repeating within a few rounds.
- Online questions come from a free API that rate-limits by IP, and our own
  fetcher fired two requests at once whenever a match started early. So it got
  rate-limited, then fell back to the thin pack.

**Added**
- **104 new curated questions (189 total).** Every subject now has 4–6 of each
  difficulty. Facts are double-checked, the wrong answers are clearly wrong,
  and film questions name the film.
- `sim/pack-check.ts` (in `test:e2e`) checks:
  - valid tiers and subjects
  - three distinct wrong answers, none equal to the right one
  - no duplicates
  - at least 4 questions per subject per tier
  - five offline periods with no repeats and the points ramp intact

**Fixed**
- Online questions go through one request queue. Two loops used to fire
  together, which guaranteed a "too many requests".
- A match that starts early stops its leftover fetches.
- On a rate limit the gap doubles, up to a minute, instead of hammering.

**Changed**
- "Printing the quiz…" waits at most 3s for online questions (was 8s); the
  curated pack covers the rest.

**Evidence**
- pack-check: 6 of 6 pass, including 5 offline periods with 0 repeats.
- The full browser suite plus all engine and relay checks pass.

## v0.8.0 — The yearbook · 2026-10-20 02:13

**Why:** endings are where a party game earns the next round. The report card
said who won, but nothing said who was sharp, sneaky or unlucky: the stories
people retell on the way home.

**Added**
- **Yearbook superlatives** at the end of every period: up to 4, one per
  classmate.
  - The cheater's own: 🚨 Caught red-handed, 🎓 Graduated early, 🎭 Let them
    dig (won on strikes), or 🎭 Master of disguise.
  - 🕵️ Detective: the most votes for the cheater, otherwise the earliest 👉
    at them.
  - The innocent who took the heat: 😇 Wrongly accused or 🙈 Red herring.
  - Quiz awards: 🧠 Top marks, ⚡ Fastest pencil, 🐢 Last pencil down.

  The host computes them once from what everyone saw, so every phone shows the
  same.
- **The yearbook of the day** at session end: 🎭 Best actor, 🕵️ Head
  detective, 🏅 Most decorated, 😇 Most wrongly accused, each only for
  something that actually happened.
- **📤 Share the day:** one line for the group chat, through the share sheet or
  copied.
- `tools/full-session.mjs` plays a whole session in a phone browser
  (Practice, 10 questions, End the day) and fails on any console error.
- `sim/yearbook-check.ts` (engine) runs in `test:e2e`.

**Evidence**
- yearbook-check: two bot periods give 1–4 superlatives, one per player, the
  cheater's first; the day's yearbook is well formed.
- The full-session smoke test passes in 197s, through every screen from lobby
  to the day's yearbook. Its only console errors were the online question
  API's rate limits, which the game survives by using its own question pack.

## v0.7.0 — First game night · 2026-10-20 01:58

**Why:** the first real session decides whether a group comes back, and three
things went wrong in it. Nobody reads a rules block before they play. A late
arrival was turned away with an error and saw nothing until the period ended.
Trying the game alone took five taps of setup.

**Added**
- **Teacher's notes:** in the first period, the first three reveals teach one
  thing each: answer times are clues, 👉 points, ACCUSE costs your one
  accusation (and two strikes end it). They use the space easy questions
  almost never fill with evidence, then get out of the way.
- **The hallway:** someone arriving mid-period is let in to watch, with a
  banner ("You're in the hallway…"). The answer buttons are closed to them,
  and their role note reads "Hallway. Watch and learn." They get a seat when
  the class is back in homeroom, never as the cheater and never on this
  period's report card.
- **Practice with bots** on Home: one tap to a classroom with five bot
  classmates.

**Evidence**
- `sim/hallway-check.ts` (8 checks on the real engine): let in, hallway not
  match, never the cheater, unique names, leaving frees the place, seated in
  homeroom with a fresh semester line.
- Phone tests for the hallway, Practice and Teacher's notes.

## v0.6.0 — Game-show sound · 2026-10-20 01:13

**Why:** the reveal was built as a game show but played in silence. The
drumroll, the stamp and the siren are half the drama, and every phone already
hits each beat within a few milliseconds, so in one room the class hears each
moment land together.

**Added**
- Synthesized sounds (no audio files, nothing to download), on the same synced
  beats as the motion:
  - the school bell on the role screen
  - a pop when a question lands
  - ticks for the last five seconds, then a whistle at pencils down
  - avatar slaps in speed order, a drumroll as long as the stakes deserve, a ta-da
    sting for the answer, a rubber stamp for evidence
  - a bell for LAST BELL
  - a gavel when a hand goes up, a stamp for the verdict, a slide whistle when
    the line drops
  - a siren when the cheater graduates, a fanfare when they're caught
  - small clicks for your own taps
- 🔊/🔇: one switch, in the lobby and the 🎓 standings sheet, remembered on
  each phone. On iPhones the audio is "ambient": it respects the silent switch
  and mixes with a voice call instead of cutting it off.

**Changed**
- "Share invite" became "📨 Invite" (it was clipped on 320px phones).

**Fixed**
- A screen's first beat no longer counts as entering it again, which buzzed
  twice at match end.

**Evidence**
- A new test hears a question and its reveal from the cheater's seat and from
  the same seat masked: the same sounds, in beat order.
- The sound switch silences everything and survives a reload.
- No console errors.

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

## v0.3.0 — Phone play · 2026-10-19 23:57

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
