# How Did You Know That?!

A school-themed, browser-based social deduction party game disguised as a pop
quiz. The class answers the same 10 questions — each from a different school
subject — but one classmate secretly sees the correct answers. The cheater
races to a public "graduation" score line; everyone else watches picks and
answer times, then burns their one accusation to send someone to detention.

Built from the specs in `00-overview.md` … `07-ui-screens.md`.

## Extras beyond the specs

Newest first (details in `CHANGELOG.md`, decisions in `PRODUCT.md`):

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
