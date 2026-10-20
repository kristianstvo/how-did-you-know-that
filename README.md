# How Did You Know That?!

A school-themed, browser-based social deduction party game disguised as a pop
quiz. The class answers the same 10 questions — each from a different school
subject — but one classmate secretly sees the correct answers. The cheater
races to a public "graduation" score line; everyone else watches picks and
answer times, then burns their one accusation to send someone to detention.

Built from the specs in `00-overview.md` … `07-ui-screens.md`.

## Extras beyond the specs

Newest first (details in `CHANGELOG.md`, decisions in `PRODUCT.md`):

- **Game night ready** (v0.18) — `npm run game-night` plays a whole evening;
  the big screen rolls long screens by itself.
- **Called it** (v0.17) — after the unmask: how the cheater played against the
  class, and who was pointing at them.
- **The big screen** (v0.16) — open `#/tv/CODE` on a TV or laptop: the
  room's shared stage, never a player.
- **Fresh eyes** (v0.15) — 14 fixes from an independent screen-by-screen
  review; the day's points are ⭐ gold stars.
- **The unkillable host** (v0.14) — the teacher's page can reload mid-game
  and take the class back.
- **Rules at a glance** (v0.13) — How to play is four cards, open for
  first-timers.
- **Your report card** (v0.12) — every phone remembers its own record.
- **Fair start** (v0.11) — the cheater is told to find the dot; practice as
  a chosen role with bots.
- **Hosting made easy** (v0.10) — pace presets, New day same class, clear a
  seat.
- **Question bank 2.0** (v0.9) — 189 curated questions; no more rate-limit
  storms.
- **The yearbook** (v0.8) — superlatives every period, the day's yearbook,
  Share the day.
- **The hallway** (v0.7) — arriving mid-period, you watch it and get a seat at
  the next one. **Teacher's notes** teach the rules inside the first period.
  **Practice with bots** is one tap from Home.
- **Game-show sound** (v0.6) — synthesized, on the synced beats; one switch.
- **Point at a suspect** (v0.5) — 👉: free, public, not a vote.
- **Two strikes** (v0.4) — the 2nd wrong detention graduates the cheater;
  default line 2100.
- **Phone play** (v0.3) — see `10-phone-play.md`.

- **Bots** — the teacher (host) can add bot classmates in the lobby to fill
  seats for solo testing. Bots answer with tier-scaled accuracy (a bot cheater
  "reads the marker"), vote in every detention vote, and occasionally burn
  their own accusation when the cheater is closing in on graduation.
- **School-themed avatars** — pick an emoji avatar on the name tag; it follows
  you across the roster, reveals, votes, and report cards.
- **Subjects** — every match draws 10 distinct school subjects (Math, Science,
  History, P.E., Mythology, …), one per question, mapped to OpenTDB categories.

## Run it

```bash
npm install
npm run build   # builds the client into client/dist
npm start       # serves game + relay on http://localhost:3000
```

Open `http://localhost:3000` on the host's phone/laptop, create a lobby, and
share the invite link (`/#/join/CODE`). 3–10 players, 4+ recommended.

## Hosting a game night

1. **One laptop runs the game** (`npm start`). Phones on the same Wi-Fi
   open it at the laptop's network address, for example
   `http://192.168.1.20:3000`, not `localhost`.
2. **The teacher (host) creates the class on their phone.** They show the
   QR (📷 Show QR), which carries that address to everyone else, or share
   the invite link. 4–8 players is the sweet spot, and bots fill seats.
3. **A TV or the laptop can be the big screen.** The teacher's QR card shows
   its link (`/#/tv/CODE`). Click once there for sound. It shows the whole
   show for the room and never plays.
4. **The teacher's phone is the game.** A reload, a crash or a locked
   screen is fine: the class waits a few seconds and carries on. Closing
   the tab for more than 90 seconds ends the class.
5. **Trying it alone first?** Home → Practice with bots, then in the
   lobby pick "Practice as: 🤫 Cheater" to learn the dot.

Playtest tools (event-log downloads) appear with `?playtest` in the URL.
`npm run game-night` (with the server running) plays a whole evening
automatically as a smoke test.

For development (client hot reload on :5173, relay on :3000):

```bash
npm run dev
```

## Architecture (spec 05)

- **`server/index.ts`** — dumb Socket.IO relay: rooms, 5-char codes, message
  forwarding, static serving of the built client. Zero game logic.
- **`client/src/engine.ts`** — the host-authoritative game engine. Runs in the
  *host player's browser*: validates intents, owns all state, broadcasts
  public snapshots plus private per-socket secrets (role + correct answer).
- **`client/src/providers.ts`** — content pipeline: one OpenTDB fetch per
  subject slot (session token, ≥5s request spacing, background prefetch of the
  next match) with the subject-tagged local pack (`localPack.ts`) filling any
  slot that isn't ready or errors (offline badge).
- **`client/src/screens/`** + **`client/src/styles/`** — one module and one
  stylesheet per screen, mobile-first portrait. `main.ts` routes screens;
  `render.ts` morphs the DOM (idiomorph) and runs View Transitions between
  screens.
- **`shared/choreo.ts`** — the reveal show: beat timelines (pencils down →
  slap avatars → drumroll → answer → ✓/✗ and times → evidence callout → grade
  book → ACCUSE) as pure functions of public data, scaled by stakes.
- **`client/src/clock.ts`** — shared server clock, so every phone hits each
  beat at the same moment.
- **`shared/evidence.ts`** — picks the reveal callout (lone correct, against
  the crowd, lightning, streak, near the line, CLEARED, …) and keeps the case
  file.
- **`shared/protocol.ts`** — types shared by relay, engine, and player UI;
  also the single table of default settings and session point values.

## Phone play

Measured and tuned for real phones (`10-phone-play.md`): the screen stays
awake in a classroom, dropped connections recover by themselves (the host's
too), a reload rejoins the same seat, votes are pick-then-hand-in, ACCUSE
ignores fumbled double-taps, and the lobby shows a scan-to-join QR. Every
screen keeps its main controls on screen from an iPhone SE upwards.

```bash
node tools/phone-audit.mjs --label mine   # measure every screen at 7 phone sizes → capture/phone/mine/
```

## Show direction and proofs

The design rationale, beat sheet, motion language and simulation findings are
in `08-reveal-direction.md`; the playtest procedure is in
`09-playtest-checklist.md`.

```bash
npm run test:e2e     # build, protocol + relay checks, then Playwright: parity, sync, perf, a11y, phone (uses Edge)
npm run sim          # seeded headless match simulation, writes sim/out/
npm run typecheck
```

Recorded matches replay at `/#/fixture/<caught|graduated|topscore|detention>`
with a scrubber. Add `?as=cheater` to watch from the cheater's seat, `&mask=1`
for the same seat as an innocent, and `&host=1` for host controls.

## Known accepted limitations (spec 00)

- The lobby host can open dev tools and see the cheater — hosts are trusted.
- If the host's phone drops out (screen lock, app switch, lost signal), the
  room waits 90 seconds for it to come back; closing or reloading the host's
  page still ends the session (no host migration).
- Answer times are client-reported (clamped to the timer) — trust your friends.

## Rules knobs

Host-editable in the lobby: question timer, cheater threshold (default 2100),
threshold drop per wrong banishment (default 200), and strikes: wrong
detentions before the cheater graduates (default 2, 0 = off). Session point
values live in `SESSION_POINTS` in `shared/protocol.ts`. Product decisions
and the version history: `PRODUCT.md`, `CHANGELOG.md`.

One deliberate interpretation of spec 03: banishment votes may target any
**non-banished** player ("any player" in the spec, minus already-banished ones,
since a second banishment is a no-op).
