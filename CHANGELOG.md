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
