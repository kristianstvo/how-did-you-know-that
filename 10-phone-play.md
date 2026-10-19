# 10 — Phone play

The game is played on phones, in hand, often on a voice call, sometimes on
cellular. This pass measured what goes wrong on real phone screens and real
phone behaviour (locking, app switching, dropped signal), fixed it, and added
tests so it stays fixed.

## How it was measured

`tools/phone-audit.mjs` replays recorded matches (including a new 10-player
fixture, `fullclass`, with 20-character names) and measures every screen at
the **visible** viewport of real phones, i.e. after the browser's own bars:

| Phone | Visible viewport |
|---|---|
| iPhone SE (1st gen), Safari | 320×460 |
| iPhone SE 2/3 · 8, Safari | 375×553 |
| Galaxy A/S, Chrome | 360×640 |
| iPhone 15, Safari | 393×659 |
| Pixel 7/8, Chrome | 412×780 |
| iPhone Pro Max, Safari | 430×739 |
| iPhone held sideways | 760×330 |

For each screen and phone it records whether every primary control is on
screen without scrolling (a control behind a pinned bottom bar counts as
hidden), how far down the screen it sits, tap targets under 44px, text under
12px, inputs under 16px (iOS zooms the page into those) and sideways
overflow. It also runs two interaction probes. Reports and screenshots:
`capture/phone/{before,after}/`.

## What was wrong

| Finding | Where |
|---|---|
| **A host whose phone locked, switched apps or lost signal ended the game for everyone.** iPhones auto-lock after 30s by default, and a reveal discussion runs longer than that. | relay + host |
| Nothing kept the screen on. Nothing told a player their phone had dropped out. | all |
| Join and Create were below the fold on the most common small phones (SE 2/3: bottom at 696px of 553; Galaxy: 718 of 640). | home |
| Two of four answers were below the fold on a 1st-gen SE; all four when held sideways. | question |
| With a full class, 2 of 10 classmates were below the fold on an SE 2/3, 6 on a 1st-gen SE. | vote |
| One tap cast a vote, with no way back. A mis-tap among ten names was a wasted vote. | vote |
| A fast double-tap on ACCUSE burned the token (measured: two taps 90ms apart started a vote). | reveal |
| Scroll carried across screens: after scrolling down the grade book, the vote opened 262px down, with the accuser and the timer off screen. | all |
| The lobby's number fields were 14.7px, so iOS zoomed the page into them. | lobby |
| Answer times (the main clue) were 11.5px; vote answer chips 11.8px; avatar badges 8.3px. | reveal, vote |
| The handwriting font fell back to Android's `cursive`, Dancing Script: a joined-up script that is hard to read at a glance. | Android |
| Reloading (or the browser discarding a background tab) dropped a player on the home screen to retype everything. | all |

## What changed

**Connection** (`server/index.ts`, `client/src/net.ts`, `client/src/wakelock.ts`)
- The relay keeps a room for **90 seconds** after the host's phone drops out
  (`HOST_GRACE_MS`). Messages for the host are held and delivered in order
  when it is back. The host's phone reclaims the room with a secret key it got
  at creation, and the engine re-sends everyone's state and secret.
- Players see a banner, never the home screen: "📵 The teacher's phone dropped
  out. Hang tight…" or "📶 Reconnecting… your seat is saved".
- Coming back to the page (unlock, app switch, network change) reconnects at
  once instead of waiting out the backoff, and replaces a socket that looks
  open but is dead.
- The **Screen Wake Lock** keeps every phone awake while it is in a classroom,
  and is taken again on return.
- A reload or a discarded tab on a classroom link rejoins the same seat
  automatically.
- The host's page asks before closing or reloading mid-game, since leaving it
  still ends the session.

**Touch**
- Voting is **pick, then hand in**. A tap picks a classmate (changeable); the
  sticky **Hand in** button, in thumb reach, sends it. A pick that is never
  handed in goes in by itself 1.2s before the vote closes. Still no take-backs
  once handed in.
- ACCUSE ignores a confirm tap that comes within 450ms of the first tap, so a
  fumbled double-tap does nothing. A deliberate second tap still accuses.
- No double-tap zoom (pinch zoom still works), no pull-to-refresh, no text
  selection or callout menu on a press-and-hold.
- The phone keyboard's Go key works: Go on the code joins. Go on the name
  joins when the code is filled in already (an invite link), and otherwise
  closes the keyboard.

**Layout**
- Every new screen starts at its top.
- Home: you write your name straight onto the "HELLO my name is" sticker
  (one field instead of a preview plus a field). On short screens the avatars
  become one swipeable row.
- Question: on short screens the subject card, the timer and the reserved
  question lines tighten, and answers stay ≥50px tall. Held sideways, the
  question sits on the left and the answers on the right.
- Vote: a compact raised hand on short screens, the countdown pinned to the
  top while the class list scrolls, and more columns when held sideways.
- Inputs ≥16px everywhere. Safe-area padding for the home indicator on every
  pinned bottom bar, and for the notch when held sideways.
- Answer times 11.5 → 12.8px, vote chips 11.8 → 13.1px, the grade-book line
  label 10.6 → 11.8px, avatar ranks/verdicts 8.3 → 9.9px, badges 9.9 → 10.9px.
  On 320–359px-wide phones the score bar narrows to give names room.
- The handwriting font now tries Android's plain handwriting face (`casual`,
  Coming Soon) and otherwise falls back to sans-serif, never a joined-up script.

**Joining**
- The lobby has **Share invite** (the phone's share sheet) and **Show QR**: a
  big black-on-white code that opens the classroom with the code filled in,
  for friends in the same room. Any player can show it.

## Results

Same audit, same phones, before → after:

| Check | Before | After |
|---|---|---|
| Primary controls hidden below the fold (screen × phone) | 23 | 5 (the after count also treats pinned bars as the fold) |
| Home: Join / Create visible without scrolling | 3 of 6 portrait phones | 6 of 6 |
| Question: all four answers visible | 5 of 7 phones | 7 of 7 (including sideways) |
| Vote, 10 players, SE 2/3 | 2 classmates hidden | 0, with the Hand in dock pinned |
| Vote opens at its top after scrolling the reveal | no (262px down) | yes |
| A double-tap on ACCUSE starts a vote | yes | no |
| Inputs that make iOS zoom | 3 | 0 |
| Sideways overflow | none | none |

Still scrolling (all with the timer and the main button pinned in view): a
full class of 10 on a 1st-gen SE (4 of 10 classmates below the dock), and
held sideways the lobby's share buttons, the reveal's answer board and the
vote grid.

**Tests** (`npm run test:e2e`)
- `sim/relay-check.ts` drives a real relay with a 1.5s grace period. It checks
  that players are told when the host is away and the room stays open; that
  only the host's key takes it back; that held messages arrive in order; that
  the grace timer is cancelled once the host is back; that the room closes when
  the host stays away; and that a late host is told so.
- `tests/phone.spec.ts`, on a 375×553 touch screen:
  - the host's phone drops out mid-match and comes back, and the game carries on
  - a player drops out and is back in the same seat
  - a reload rejoins on its own
  - a double-tap on ACCUSE does nothing, while a deliberate tap accuses
  - a vote tap only picks, Hand in sends, and a pick goes in before the bell
  - the screen is kept awake, and the host's page asks before leaving
  - the QR is ≥240px wide and stays up when tapped
  - screens start at the top
  - no zooming inputs and no sideways scroll at 320px

## Known limits (check on real phones)

- **The host's page must stay alive.** A dropout is survived, but closing or
  reloading the host's page still ends the session: the game lives in it.
  iOS can also discard a page that sits in the background for long under
  memory pressure.
- Wake Lock needs iOS 16.4+ (Safari), or Chrome 84+ on Android. Low Power and
  battery-saver modes may refuse it, and then the phone can still lock.
- The QR code was checked for size and layout. This Edge build has no barcode
  reader, so it was not scanned here: scan it once with a real phone.
- The Android font change can't be seen in this Windows test browser: check one
  Android phone.
- Answers or votes sent while the host's phone was away are delivered when it
  is back. If the host's question timer ran out meanwhile, they arrive too
  late to count.
