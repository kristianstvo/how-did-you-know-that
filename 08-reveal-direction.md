# 08 — Reveal Direction: findings, beat sheet, motion language

The reveal is the game's storyline. Each one adds evidence to a case the room
builds across 10 questions. Its job is to get people accusing each other out
loud on the voice call (spec 00's success criterion). This document says what
the data and research show, and how every screen plays as a result.

**Sources**
- `sim/` is a headless simulator that runs the real host engine through the
  real protocol.
- `sim/out/FINDINGS-DATA*.md` are its generated tables.
- `design/research-*.md` are three cited research briefs.
- `capture/current/REPORT.md` is the baseline capture of the old build.
- **Provenance note:** the three-director design panel failed on a network
  error. Two independent judges then analysed the source files and converged
  on the same direction. This document is that direction, merged with the
  simulation data.

---

## 1. What the data says

> **Since v0.4** the rules changed: two strikes (the 2nd wrong detention
> graduates the cheater) and a default line of 2100. The numbers below are for
> the v0.2 rules; the decision and its evidence are in `PRODUCT.md`.

These numbers come from 19,000 simulated matches across 95 scenarios, run
through the real engine and protocol. The player model is grounded in Kahoot
and psychometrics data (`design/research-human-quiz-behavior.md`): lognormal
response times, faster knowers, rapid guessers and last-second taps. The
protocol checks were clean: the cheater's secret was never wrong and never
leaked. Runs are deterministic, with byte-identical logs per seed (checked by
`sim/determinism.ts`).

### Robust (these follow from the rules, not from the player model)

| Finding | Number | Design consequence |
|---|---|---|
| A perfect cheater crosses 1400 at exactly Q8 | 300 + 800 + 400 = 1500 | The **Q7 reveal is the room's last chance**. This is computed as the **LAST BELL**, not hard-coded: it is Q6 after two wrong detentions and Q8 with a 1600 line |
| Anyone at or above the line with no siren is **provably innocent** | An innocent ends at or above the line in 43–79% of no-accusation matches | **CLEARED** stamp, the highest-priority callout. In a score-following room, **17–20% of wrong banishments** hit a player already at or above the line (28 of 163 and 39 of 194). A room that respects CLEARED makes none, and a careful cheater's win rate falls from 80% to 73% (sprint: 84% to 76%, 6 players) |
| Speed only betrays a careless cheater | Speed-tell AUC 0.93 for a cheater who taps in about 2s. For one who waits like a human: 0.49–0.53 (95% CI ±0.03) | Show time order (the slap order), but phrase speed as a question. Rapid guessers (10% of non-knowers) answer in about 2s too |
| Evidence is a hint, not proof | Lift against careless or mimicking cheaters: 3–5×. Against careful or late-sprinting ones: about 1.0–1.5× | Every callout is an **observation plus a question**, never a verdict. The case file carries "Evidence, not proof." |
| Callouts fall into a three-act shape | Announced on ~0% of easy, ~73% of medium, ~95% of hard reveals (0.45 per question overall) | **Act I: Warm-up** (Q1–3) is quick and quiet. **Act II: Pop quiz** (Q4–7) makes the evidence card the star. **Act III: Final exam** (Q8–10) gets the full drumroll |
| Room size changes which evidence appears | "Only one got it" on a hard question: 17% of reveals at 4 players, 2–3% at 8 | Small rooms lean on lone_correct. Big rooms lean on streaks, speed and the line race |

### Model-dependent (verify in playtests; the event log measures these)

| Finding | Number |
|---|---|
| At the default line (1400), a careful or late-sprinting cheater wins against every simulated room behaviour (4–8 players) | 62–97% cheater wins |
| Raising the line moves those cheaters toward the 35–55% target (6 players) | 1800: 53–81%; **2000: 43–64%** |
| Rooms that only follow evidence rarely accuse disciplined cheaters | 0.2 accusations per match. Real people also read the raw rows, which the sim does not model |

**Balance recommendation (spec 02 lever):** playtest at the default 1400 *and*
at 1800 or 2000, then compare the cheater win rate in the event-log report
(§7). Don't change the default until real data says so.

### Bugs the analysis found and fixed

- **The offline fallback used the wrong difficulty slot.** It put a question in
  the wrong tier in 72–98% of offline matches from the second match of a session
  onward, shifting the score ramp by about 190 points per match. Now 0%.
- **The cheater's answer marker changed layout.** The marked option grew 2px
  taller and lost the "your pick" outline. It is now a geometry-free dot.
- **The role screen was a tell.** Innocents saw a blank line where the cheater
  read text. Both now read same-length lines, shown on the same beat.
- **The winning answer vanished.** A threshold win never showed its final
  reveal. It now rides along into the match-end state.
- **The shipped bots accused at Q2–3 at random.** They now accuse from evidence
  and score pressure, only after the show. A bot cheater wins 39–47% of bot
  matches, and the first accusation comes at a median of Q6.

### Bugs the adversarial code review found and fixed

Four independent static reviewers (cheater-identification leaks, clock and
sync, game rules, motion and accessibility) went through the implementation.
Every finding was checked against the code. The confirmed ones are fixed:

- **Leaks**
  - **The cheater's secret packet was 1–2 bytes shorter on the wire.** Every
    copy is now padded to the same length: all 464 recorded packets are 67
    bytes, checked by `sim/protocol-check.ts`.
  - **Anyone typing a disconnected player's name received that seat, and its
    secret, mid-match.** Seats now carry a token, and only the original phone
    can rejoin mid-match.
  - **A bot cheater never accused**, so any bot that accused was provably
    innocent. The cheater bot now bluffs under the same rule.
  - **The semester sheet revealed vote outcomes before the verdict stamp.** It
    is hidden during votes.
  - **The role lines had different emoji colours.** Both now use 🤫.
  - **A stale role line could flash on a late rejoin.**
  - **Players absent at the bell were secretly ineligible to be the cheater.**
    They are now CLEARED publicly.
- **Game**
  - **Removing a bot while questions loaded could crash the match.**
  - **The reconnect race left ghost seats.**
  - **A host skip let bots roll a second accusation.**
  - **A malformed answer time could put NaN into the reveal.**
  - **A "debug: force the cheater" hook was reachable in production.** It is now
    local-only, and announced in the lobby while active.
- **Sync**
  - **Beat 0 was stamped at the host's "now".** Remote phones landed every beat
    one network trip late. Phases now start a 250ms beat lead in the future.
  - **A clock resync could replace a good offset with a congested one**, and
    the clock could run backwards.
  - **A two-beat host skip wasn't settled.**
  - **"Settle" replayed animations when it ended.** It now finishes them
    through the Web Animations API.
  - **The morph froze any focused button.**
- **Motion and accessibility**
  - **The grade book was still moving when ACCUSE armed.**
  - **White-on-red buttons failed WCAG contrast.**
  - **Reduced-motion fades were too short** (160ms), and the button press
    still scaled.
  - **Live regions re-read the whole reveal.**
  - **A loading pulse ran longer than 5s.**
  - **Focus rings were clipped**, and the standings dialog had no keyboard
    close.
- **Data**
  - **The match log re-exported the whole session**, so the report counted
    matches several times.
  - **The log omitted the callout that was actually shown.**
  - **The case-file recap counted CLEARED as evidence.**
  - **A reload made the next answer look fake-fast.**

---

## 2. Motion language (`client/src/styles/tokens.css`)

| Token | Value | Use |
|---|---|---|
| `--t-tap` | 100ms | Press feedback |
| `--t-quick` | 160ms | Small state changes |
| `--t-base` | 240ms | Standard entrances and exits |
| `--t-stamp` | 320ms | Slaps and stamps (impact) |
| `--t-scene` | 450ms | Cards, banners, screen changes |
| `--t-drama` | 700ms | Grade-book bars, the graduation line moving |
| `--e-standard` | `cubic-bezier(0.2,0,0,1)` | Default |
| `--e-enter` | `cubic-bezier(0.05,0.7,0.1,1)` | Entrances (M3 emphasized decelerate) |
| `--e-exit` | `cubic-bezier(0.3,0,0.8,0.15)` | Exits (M3 emphasized accelerate) |
| `--e-impact` | `cubic-bezier(0.34,1.56,0.64,1)` | Slaps and stamps (overshoot) |
| `--stagger-info` | 110ms minimum | Staggers where the order carries meaning |
| `--stagger-deco` | 50ms | Decorative cascades only |

**Rules**
- Animate only `transform` and `opacity`.
- Every box is reserved from frame 0, so beats never cause reflow.
- Information-bearing beats sit at least 150ms apart, and an entrance lasts at
  least 200ms (6 frames at 30fps, the iOS Low Power Mode cap).
- Nothing that carries information moves after ACCUSE arms.
- Grade-book rows are positioned with `translateY`, so reordering animates on
  the compositor. Bars use `scaleX`, and the graduation line uses `translateX`.

**Impact recipe** (`hd-slap`, `hd-stamp`): start at scale 1.7–2.2 rotated −8° to
−12° at opacity 0, overshoot to 0.9 at 60–70%, settle at 1. On high stakes only,
the parent gets a 3px shake.

**Reduced motion:** every named keyframe is redefined as opacity-only *at the
same beat times* (WCAG 2.3.3). View Transitions become fades.

**Settle:** when a render crosses two or more distinct beats at once (a host
skip, a late join, a return from a vote), passed beats render in their final
state. The shell finishes their animations through the Web Animations API, so
nothing replays. Screens list only distinct beat times, so that rule can't fire
on beats that simply share a timestamp. Elements that run on the shared clock,
such as timer bars, opt out with `data-keep-style`.

**Sync:**
- Every phone syncs to the relay server's clock. It keeps the lowest-RTT
  samples across bursts (one congested resync can't override a good estimate),
  takes the median, and resyncs periodically and whenever it regains focus.
  `serverNow()` never runs backwards.
- **Every phase starts a 250ms beat lead in the future**, so the state reaches
  every phone before beat 0.
- Every beat is `startedAt + offset` on that clock, computed by pure functions
  of public data (`shared/choreo.ts`). The cheater's phone runs the identical
  timeline.

---

## 3. The reveal: beat sheet (`shared/choreo.ts`)

**Stakes:**
- **high** if the question is hard, the callout is strong (near_line, cleared,
  lone_correct, hard_sweep or against_crowd), or LAST BELL is active
- **mid** if the question is medium or there's any callout
- **low** otherwise

**Layout at 380px:**
- **Header:** Q n/10 · subject · tier ticks · act chip
- **Question text:** two lines at most
- **The Board:** 4 option rows, each with an avatar tray
- **Evidence slot:** fixed height
- **Grade Book:** rows sorted by score, each showing time, +points, exhibits,
  stamps and a bar, with the graduation-line marker across the bars
- **ACCUSE dock:** fixed height

Times are milliseconds from `reveal.startedAt`, which the host sets 250ms after
it sends the state (the beat lead). Figures are for 6 players; the slap phase
grows by one stagger per extra player.

| Beat | low | mid | high | What happens |
|---|---|---|---|---|
| pencils | 0 | 0 | 0 | "✏️ PENCILS DOWN" stamps over the Board. The option rows are neutral |
| slap | 250 | 400 | 600 | Avatars slap into the tray of the option they picked, **fastest first**. Stagger 110/140/190ms. Players who didn't answer drop into a "🤐 no answer" chip. The first three get small ①②③ speed ranks |
| drumroll | +250 after last slap | same | same | The Board dims and a chalk underline sweeps across. Hold 300/800/1400ms. High stakes adds a slow shimmer |
| answer | ≈1.35s | ≈2.15s | ≈3.2s | The correct row gets a ✓ stamp and a solid border, and its avatars pop. Wrong rows get ✗ and a thin, faint outline (dashed until v0.22). **The room reacts out loud here** |
| verdict | +350 | +450 | +600 | ✓ or ✗ badges on tray avatars. Time chips land on Grade Book rows (⚡ marks the fastest correct). "+points" pops |
| evidence | (none) | +550 | +700 | The **EXHIBIT** card stamps into the slot: icon, title, observation, question. Its icon pins onto the subject's row as an exhibit badge |
| grade | +350 | callout hold 1300 | callout hold 1600 | Bars grow with `scaleX` from the old to the new share, and rows reorder with `translateY`. CLEARED stamps land. **LAST BELL** banner if active |
| accuse | +750 → ≈2.8s | +750 → ≈5.2s | +750 → ≈6.85s | ACCUSE arms with one glow pulse once the 700ms grade-book motion has finished: nothing that carries information moves after this. **Talk hold** begins |
| Next | max(8s, accuse+2.5s) = 8.0s | 8.0s | 9.35s (10.1s at 10 players) | The host's Next unlocks. "Skip ⏩" is available before ACCUSE arms (everyone jumps together) |

**Low stakes, without a callout:** the evidence slot shows a one-line **class
note** at the grade beat, for example "Everyone got it.", "4 of 6 got it.", or
"Fastest: Maya 2.1s".

**Callout copy** (`screens/common.ts`; observation plus question):

| Kind | Example |
|---|---|
| lone_correct | "Only Maya got this one. Genius… or cheat sheet?" |
| against_crowd | "4 classmates fell for the same trap. Maya didn't. Lucky, or looking?" |
| lightning | "Maya: 1.2s. The class: 6.8s. Fast fingers, or a peek?" |
| streak | "Maya hasn't missed in 6 questions. Teacher's pet?" |
| hard_sweep | "Maya aced every hard question so far. Who studies THAT much?" |
| near_line | "Maya is 300 points from the line. If it's them, it's now or never." |
| stumper | "Nobody got it. Not even the cheater. Someone's playing it safe." |
| cleared | "Kiko crossed the line. No siren. Proven innocent." |
| LAST BELL | "🔔 LAST BELL — if it's Maya, Leo, they graduate next question." |

---

## 4. Every other screen

| Screen | Beats (ms) | Notes |
|---|---|---|
| **Home** | Title wobble-in at 0. The name-tag card and the two cards rise with a 50ms deco stagger. Picking an avatar pops the choice and updates a live "HELLO my name is" sticker | Errors shake (`hd-shake`) |
| **Lobby** | Room-code letters drop in (deco stagger). Each new classmate's row pops in as they join; bots "boot" with a spin. Start becomes ready with one glow pulse. Copy shows a toast | The Start dock is sticky (it used to sit below the fold at 380×800). Targets ≥44px |
| **Role** | bell 0 (swing), line1 350, line2 1000, role 1700, next screen at 3200 (5200 in a day's first period, so a first-timer can read the note: v0.27) | Both role lines have the same length, weight, colour and emoji: "It's you. Play it cool. 🤫" and "Not you. Watch closely. 🤫". Both appear on the role beat, never when the packet arrives, and neither is announced through a live region (a screen reader could otherwise speak it into the room) |
| **Question** | The subject flashcard flips in (0–450). The question rises at 150. Options cascade at 250 plus 50 each. The timer bar runs on `scaleX` on the compositor, with a negative delay for the time already elapsed. Urgent from deadline −5000: red bar and the number pulses. On tap: press, then a "LOCKED IN" stamp, then other options fade to 55%. A **"locked in" avatar strip** pops each classmate in as they answer. "✏️ PENCILS DOWN" at the deadline | The cheater's marker is a faint corner dot with no geometry change |
| **Vote** | Takeover: the accuser's avatar and "🙋 MAYA RAISES A HAND" stamp. The candidate grid cascades in seat order (110ms). The countdown bar runs on `scaleX`. A "handed in" strip pops avatars as votes land (who voted, never for whom). Your pick gets a chalk-circle stamp | Each cell shows exhibits, the candidate's last pick and time (✓ 4.1s), and a **CLEARED** stamp (still votable, but labeled) |
| **Vote result** | sealed 0: "THE VOTES ARE IN…". Flips start at 700, one every 260ms in seat order ("Maya → Leo"), and tally chips count up. Verdict at last flip +1300: a "DETENTION: LEO" or "CHEATER CAUGHT ✓" stamp. Drop at +1100: the graduation-line marker **slides left** (`translateX`) with "−200 → 1200". Done at +1400 | Votes are revealed with names (Among Us convention) |
| **Match end: graduated** | Siren takeover at 0 (red overlay pulses ×3). **Final blow** at 300: "Q8 · Leo answered 'Femur' in 4.1s → 1500 🎓". Unmask stamp at 1300. Scores at 2400. Case-file recap at 3500. Session deltas at 4800. Done at 5700 | The answer that did it is shown (carried in the matchEnd state) |
| **Match end: caught / top of class** | Banner at 0 and confetti on caught. Drumroll "The cheater was…" from 700. Unmask at 2500. Scores at 3600. Case file at 4700. Session at 6000. Done at 6900 | The case-file recap lists the exhibits against the cheater, and those that pointed at innocents (evidence ≠ proof) |
| **Session end** | Podium columns rise 3rd → 2nd → 1st (`scaleY` from the bottom, 300ms apart). Valedictorian stamp. Confetti. The standings list cascades | The host can download the session log |
| **Semester tab** | The sheet slides down (`hd-enter-down`) over a faded backdrop | Available from any match screen |

**Screen transitions** (one View Transition per screen change, never per
broadcast):

| Change | Transition |
|---|---|
| Question → reveal | **flip** (the sheet is handed in) |
| → vote, → match end | **takeover** (slam over a darkened room) |
| → question, → role | **rise** |
| Vote result ↔ reveal | **fade** |
| Lobby or home changes | **slide** |
| Any change, under reduced motion | **fade** |

---

## 5. Time budget

Measured by rerunning the simulator on the new engine with the full show
timings:

| | Old build | New |
|---|---|---|
| Match with no accusations, p50 | 152–202s | +1 to +7s (the 250ms beat lead per phase, plus high-stakes holds) |
| Matches with accusations, p50 | 121–218s | +3 to +14s (median ≈ +8s); under +2s per question played |
| Built-in bot rooms | — | +13s (6) and +34s (8 bots): the retuned bots end matches about one question later, so this is longer play, not longer shows |
| Low and mid reveals | 8s minimum | Show ends by about 2.8s or 5.2s, inside the same 8s minimum (no added time) |
| High reveals | 8s minimum | Up to +1.35s (6 players) or +2.1s (10 players) beyond the minimum |

**Fatigue control** (pacing brief principles 1, 4, 5, 6):
- No drumroll on a settled easy reveal.
- A callout kind doesn't repeat on consecutive reveals when an alternative of similar strength exists. near_line and CLEARED may repeat, because they carry the line race.
- The vote and match-end screens act as breaks.
- The peak and the end get the full ceremony.
- The host can skip any show.

---

## 6. Hard constraints (how they're enforced)

| Constraint | Enforced by |
|---|---|
| Parity: cheater and innocent run the same timeline and layout, except the marker | Timelines are pure functions of public data. Parity test: `tests/parity.spec.ts` |
| Sync within 150ms across phones | Shared server clock. Sync test with three clients and injected clock skew: `tests/sync.spec.ts` |
| At least 55fps during the reveal with 4–6× CPU throttle | `tests/perf.spec.ts` on a fixture replay. Caveats: CPU throttling doesn't slow the GPU, iOS Low Power caps at 30fps, so beats are designed to read at 30fps, and a real mid-range Android should be checked |
| Correctness without colour | ✓/✗ glyphs, thick tinted vs thin faint outlines (dashed until v0.22), the CLEARED word |
| Haptics never carry information alone | Android only; each buzz mirrors something on screen |
| No role leak through packet size | Every secret is padded to the same length. `sim/protocol-check.ts` |

### Latest results (`npm run test:e2e`, Edge, 380×800)

| Check | Result |
|---|---|
| Protocol | 464 secret packets, all 67 bytes; a mid-match seat takeover needs the seat token |
| Parity | caught 115, graduated 161, topscore 151, detention 143 instants: **0 differences** |
| Sync, skewed clocks (+2.5s, −1.7s) | median 0ms, worst 8ms |
| Sync, plus 150ms latency on one phone | median 0ms, worst ≤ 8ms |
| Frame time at 4× and 6× throttle | p95 8.3–8.5ms; ≤ 0.92% of frames over 18.2ms (55fps) |
| Accessibility | 28 moving animations at full motion, 0 under reduced motion; tap targets, overflow and colour contrast pass |
| Simulator determinism | Same seed gives byte-identical reports |

### Known issues

- **First reveal of a session** costs one long frame (about 250ms at 4×, up to 410ms at 6×) for first-time style and layout. It falls inside the 250ms beat lead, so beats stay in sync, but the first slap can stutter on a slow phone. Pre-warming glyphs didn't help.
- **Role-line glyphs** differ very slightly in width between the cheater's and an innocent's line. The boxes are identical (parity passes), but a pixel-level comparison of the text itself would see it.
- **The simulator's evidence policy** doesn't model clearing after a line drop, so the CLEARED numbers in §1 slightly understate how often a drop clears someone.
- **CPU throttling doesn't slow the GPU.** The perf test is a lower bound; check on a real mid-range Android.
- **iOS:** no haptics (no Vibration API), and Low Power Mode caps the frame rate at 30fps.
- **Network latency is emulated** by wrapping the socket. Real cellular jitter is untested.

---

## 7. Measuring real playtests

The host's match-end and session-end screens have **⬇ Download match log**. It
exports a JSONL event log in the same format the simulator writes. To compare
a playtest against the simulation bands:

```
npx tsx sim/report-logs.ts <log.jsonl ...>
```

That prints time to first accusation, accusations per match, and the cheater
win rate (with a 95% CI), side by side with the simulated bands. The playtest
checklist is in `09-playtest-checklist.md`.
