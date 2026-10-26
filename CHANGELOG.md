# Changelog

Every version is a git tag. New work lives on the **`product-lead`** branch;
`main` takes it when you decide to merge (`git log main -1` shows how far it
has come). At most two versions per hour.

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

## v0.26.0 — Grading on a curve · 2026-10-26 11:12

**Why:** you asked for it: more questions, tiered by difficulty, and a quiz
that adapts to the class. Every period used to climb the same fixed ramp
(three easy, four medium, three hard), whoever was playing. Now the class
sets the difficulty as it goes.

**Added**
- **The curve.** Every period starts on a medium question. When everyone
  gets a question right, the next one is a tier harder (easy → medium →
  hard); when nobody does, a tier easier; otherwise it stays. It stops at
  easy and at hard. A phone that was away at the bell without an answer
  doesn't hold the class back; a class that leaves a question blank got it
  wrong.
- **You can see it move.** The next question's subject card is stamped
  **▲ HARDER** or **▼ EASIER**, and when there's no evidence card, the
  reveal's note says "📈 Next one's harder." or "📉 Next one's easier." On
  the big screen the host announces it ("Everybody got that one? Then here
  comes a harder one!") instead of the question number.
- **285 more questions** in the curated pack (now 474: 130 easy, 200
  medium, 144 hard), written for the curve: medium is the heart of
  the game, so it got the most. Every one was fact-checked a second time
  by an independent reviewer, and doubtful ones were fixed or dropped.
- **Fresh questions across nights.** The teacher's phone remembers the
  questions it has hosted (the last 800, on that phone only) and draws ones
  the group hasn't seen first. A repeat is worse than boring in this game:
  whoever remembers the answer looks exactly like the cheater. The
  teacher's Advanced settings say how many it remembers, with **Forget**.
- Tests: an engine check of the curve (every move, both ends, a phone away
  at the bell, a blank class, the last question, a host reload); the stamp
  and the note on a recorded period; the fresh-questions note and Forget;
  the pack check now draws whole periods on a curve, and eight periods all
  on medium, without a repeat.

**Changed**
- **The default graduation line is 2000** (was 2100). Scoring is unchanged
  (100 · 200 · 400), but on the curve the class mostly plays medium
  questions, so a period is worth about 2000 to someone who never misses.
  At 2100 a hiding cheater won 26–45% of the time at six players; at 2000
  they win 34–51%, back where v0.4 tuned the game. Teachers can still set
  any line in Advanced.
- Questions are drawn one at a time as the period goes, so the bell rings
  without a "Printing the quiz…" wait. Online questions (Open Trivia
  Database) still come when a few of each tier are ready; the curated pack
  covers the rest.
- The host's question calls no longer promise a ramp: question one, four
  and eight were re-recorded ("Question one! Let's see what you know.").
- How to play: "It starts medium: all right → harder, nobody right →
  easier." The how-to-play video's grade book shows the 2000 line.

**Fixed**
- **A phone whose clock ran ahead skipped the bell's show** when the
  teacher started within about two seconds of it joining. Its unsynced time
  stuck as the "never go backwards" floor until real time caught up. The
  floor now starts with the first real clock sync (before which nothing
  timed is on screen). The old few-second "Printing the quiz…" wait used to
  hide it.

**Evidence:** `sim/tune-line.ts 2` on the curve, hiding cheater at 6
players by line: 1800 → 45–62%, 2000 → 34–51%, 2100 → 26–45%, 2300 →
20–41%; bot rooms at 2000: 25/33/39% (4/6/8 players).

## v0.25.0 — Tomatoes! · 2026-10-26 10:14

**Why:** the unmask is the loudest moment of the night, and the only thing
the room could do with it was shout. Guests sat on "Waiting for the
teacher…" at the bottom of a long page. Pelting a busted cheater with
tomatoes, or grudgingly applauding one who got away, is physical comedy
aimed at one person, and nobody can resist the button.

**Added**
- **🍅 and 👏 on the report card.** From the unmask on, every phone (seated or
  watching from the hallway) gets a tomato and an applause button on the
  right edge, with the room's running count above them. The markup is the
  same on every phone, the cheater's included.
- **Hits land on the cheater's yearbook photo.** Every phone and the big
  screen throw the room's tomatoes from the edges of the screen; each one
  leaves a splat on the photo (up to twelve, the oldest fade first), and
  applause leaves a 👏 pop. Your own tap flies at once; everyone else's
  follow the host's count.
- **Sound stays polite.** A phone clicks only for its own taps. The big
  screen plays a splat or a clap as each hit lands, ducked under the host.
- **Fair limits.** At most one cheer every 250 ms and 30 per phone per
  period; a phone that has used its 30 shows it. Scores are unchanged.
- With reduced motion the hits fade in where they land, with no flight.
- Tests: a live room with a big screen (counts agree on every phone and the
  TV, the cheater's buttons match everyone's, phones stay quiet); the rail
  never covers scores or the teacher's buttons at SE and 320px sizes; rapid
  tapping, the spent state and a reload; engine checks for the limits, the
  hallway, the TV and a host reload.

**Changed**
- The report card's trophy column is 6px wider so the rail clears the
  scores.

## v0.24.0 — One face per desk · 2026-10-26 10:11

**Why:** the reveal trays, the locked-in desks and the ballot strip tell
people apart by face alone. Most newcomers keep the random student they're
given, so with eight players two of them were likely to share a face, and
"who picked what" stopped being readable. A taken name also dead-ended: the
phone went to the code step, where there was nothing to fix.

**Added**
- **One face per desk.** Nobody in a room shares a student any more:
  - you get the student you picked if nobody has them;
  - in homeroom, a bot gives up its student for you and moves to a free one;
  - otherwise you get a random free student (sixteen students, at most ten
    seats, so one is always free).
- **Told once.** If you didn't get your pick, one toast says so, once per
  classroom: "The Bookworm was taken, so you're the Doodler today." Your
  saved pick on the phone doesn't change.
- **A taken name offers a fix.** The phone goes back to the name tag (step 1)
  with the error and a one-tap **Join as Bea 2**. Numbering skips names taken
  in any case, and stays within 20 characters.
- Tests: two students picked twice get two faces, and only the second player
  sees the toast; a taken name lands on the name tag with "Join as Bea 2",
  which joins in one tap; a player back on a new tab mid-period is told to
  rejoin from the phone that was playing, with no "Bea 2" offer. Engine
  checks cover the bot swap, latecomers, rejoins, Add bot and the hallway.

**Changed**
- Step 1's errors sit in the Next dock, just above Next, so on an iPhone SE
  they're on screen instead of under the class photo.
- Add bot also avoids students held by latecomers in the hallway.
- A bot keeps its face on the report card: the unmasked cheater's photo never
  changes mid-show.

## v0.23.0 — No way you knew that! · 2026-10-26 10:09

**Why:** an accusation named nobody. The vote stage showed who raised a
hand and opened a 20-second ballot over every name, so nobody was ever put
on the spot, and a defence had to race the clock. Now you accuse someone
out loud, they get the floor, and then the class votes. The accuser is on
record, so a cheater who frames an innocent leaves fingerprints.

**Added**
- **ACCUSE names a suspect.**
  - If your 👉 points at a classmate, the first tap arms on them:
    "🙋 Accuse <face>? Tap again".
  - If you point at nobody, the 👉 sheet opens as "🙋 Who do you accuse?"
    (you and anyone in detention aren't listed; CLEARED players are, with
    their badge). Picking a row points at them and arms the button.
  - The second tap, at least 450 ms later, accuses. An unconfirmed arm
    resets after 4 seconds.
- **The trial.** The vote opens on the accused: their face, the accuser's
  face on a 🙋 badge, and the stamp "KIKO / NO WAY YOU KNEW THAT!".
  - **The floor:** for 5 seconds (2 for a bot) the accused has the floor.
    Ballots are closed, a bar drains, and every phone says whose turn it is:
    "🎤 You have the floor. Make your case!" for the accused, "🙋 Your
    ballot is in: Kiko." for the accuser, "ballots open in N" for everyone
    else.
  - **Ballots open** with a pop on every phone and the big screen, and the
    host's "Everybody, vote!" now lands on that moment.
  - The accused's card comes first and spans the row, with a 🎤 tag.
- **The accuser's ballot goes on the accused** the moment they accuse (no
  take-backs). The class can still vote for anyone.
- The vote result's top line says who accused whom: "🙋 Cy → Bea".
- Tests: an engine check of the new rules (who can be accused, the floor,
  ballots during the floor, a host reload mid-floor, stars); a phone test of
  the trial on three phones; the double-tap test now picks a suspect first.

**Changed**
- The accuser's +1 gold star is paid only when the person they named is
  caught as the cheater. The +2 for voting for the cheater is unchanged.
- How to play and the fine print explain naming a suspect.
- Saves and recordings from v0.22 still show the old raised-hand vote.

**Fixed (found in review)**
- ACCUSE could arm on the suspect you had just stopped pointing at, before
  the host's state caught up. It now uses the 👉 this phone last sent.
- A CLEARED badge in the 👉 sheet could squeeze a name to nothing.
- The accessibility test's fixture moments never reloaded the page, so most
  of them weren't really checked. They are now (and pass).

**Evidence:** `sim/tune-line.ts 2 2100` — every human cell unchanged (6
players hiding: 34–56%); bot rooms 4/6/8 players 27/37/45% (was 27/37/46%).
`sim/determinism.ts`: deterministic.

## v0.22.0 — Clean slate · 2026-10-20 21:42

**Why:** you said the dashed borders everywhere were distracting. The chalk
dashes outlined every card, button, field and empty seat, so nothing stood
out. And on Home's second step, Join belongs above Create: most people join,
one person creates.

**Changed**
- **No dashed borders anywhere** (68 of them). One look replaces them:
  - panels (cards, the grade book, the report card, sheets) rest on the
    board with a thin solid edge and a soft shadow;
  - buttons and toggles (secondary buttons, pace and role, sound, Add a bot,
    Practice, Change) are solid fills with a slightly raised edge;
  - empty places (desks waiting for an answer, ballot slots, the evidence
    and last-bell slots, face-down votes, Start class before it's ready)
    are recessed wells;
  - fields (the classroom code) are recessed too, and turn yellow while you
    type;
  - the graduation line is solid.
- **Wrong and innocent stay readable without colour.** The ✗ and the words
  carry it, as they always did. A wrong answer's outline is thin and faint,
  the right one's thick and tinted, and CHEATER CAUGHT keeps its double
  border.
- **Home's step 2: Join a class on top** (the code and its Join button side
  by side), **Start a class under it**, then Practice with bots.
- The how-to-play video uses the same look (`media/how-to-play.mp4` is
  re-rendered).

## v0.21.0 — Meet the class · 2026-10-20 21:17

**Why:** Home asked for everything at once: your name, an avatar, a code,
and a choice between joining and starting a class. The avatars were emoji,
which never felt like classmates. Now Home asks who you are first, then
where to, and the class is sixteen cartoon students.

**Added**
- **Sixteen students**, drawn for the game in a late-90s TV cartoon style
  (wobbly ink, flat colours, goofy proportions):
  - the Overpacker, the Bookworm, the Doodler, the Mad Scientist;
  - the Big Brain, the Square, the Artiste, the Too-Cool Kid;
  - the Jock, the Teacher's Pet, the Mathlete, the Explorer;
  - the Crayon Eater, the Beanpole, the Band Kid, the Hacker.

  All are original characters, made with an image model on ElevenLabs as
  one character sheet (`media/students.webp`) and cut into 16 portraits
  (WebP, about 15 KB each). `npm run avatars` cuts them again.
- **They replace the emoji wherever a classmate appears:** the attendance
  list, the locked-in desks, the reveal's trays and grade book, the vote and
  its verdict, the report card, the yearbook, graduation day, the big
  screen's "In class" list, and the how-to-play video (`media/how-to-play.mp4`
  is re-rendered).
- **Home in two steps.**
  - Step 1 is you: write your name on the HELLO sticker and pick your
    student from the class photo (four rows of four). Their yearbook
    nickname pops up.
  - Step 2 is where to: Join a class by its code, Start a class, or
    Practice with bots, under a small name tag with ✏️ Change.
- **Invite links skip step 2.** From a QR or a shared link, step 1's button
  reads "Join class ABCDE". A code that no longer works lands on step 2 with
  the error, where it can be fixed. "or start your own class" is under the
  button.
- The phone's back gesture goes from step 2 back to step 1 instead of
  leaving the game. Next stays in thumb reach, docked like the lobby's
  Start class.
- Tests: Home's two steps, the back gesture and the saved pick; a forged
  avatar from a hand-made client never reaches a screen.

**Fixed**
- **A security hole.** A joining phone's avatar went into every screen's
  HTML unchecked, so a hand-made client could inject markup into everyone's
  game. Now the host accepts only one of the sixteen students (anything else
  gets a random one), and the portrait renderer escapes anything it doesn't
  know.
- Typing a full classroom code by hand showed the INVITED stamp.
- An avatar saved on the phone that isn't one of the students is replaced.

**Changed**
- Home's credits: "Host voice and students drawn with ElevenLabs".
- The server caches the portraits for a day, like the voice clips.
- Tests and tools tap Next between the name and Create or Join.

## v0.20.0 — How to play, in a minute · 2026-10-20 09:54

**Why:** the rules were four cards in the lobby and a teacher's note in the
first period. That works for someone who reads. A party needs something the
whole room watches together, and a link to send before game night.

**Added**
- **A narrated how-to-play video, in the game and as an MP4.** Amy, the big
  screen's host, explains the gist between a title and a sign-off:
  1. the pop quiz on every phone;
  2. the secret cheater and their dot;
  3. the graduation line;
  4. the reveal and its evidence;
  5. pointing, accusing and the vote;
  6. what a vote does: caught, innocent, two strikes;
  7. question ten, and a tip for the cheater.
- **It's drawn in the game's own look:** the chalkboard, paper notes, stamps
  and the real phone screens. The game's own sound effects play on the
  beats.
- **Captions follow her word by word,** from ElevenLabs Scribe's word timings.
  Every picture lands on the word it shows: the magnifier finds the dot as
  she says "dot".
- **Home: ▶ How to play (1 min)** opens it full screen. In the lobby, How to
  play starts with "▶ Watch it in a minute".
- **The big screen plays it by itself** in homeroom, once Amy has welcomed
  the room, with the QR, the room code and who's in beside it. H plays it
  again; the bell ends it.
- **`media/how-to-play.mp4`:** 1080×1920 (9:16), 73 s, H.264 + AAC, for
  Reels, TikTok, Shorts or the group chat. `npm run tutorial:video`
  re-renders it from the game. It needs ffmpeg:
  `npm i --no-save ffmpeg-static`.
- The scenes are posed frame by frame from the clock, so the video in the
  game and the MP4 are the same pictures. In the game, the clock is the
  audio clock, so her words and the pictures never drift apart.
- Tests: Home's video plays with her voice and captions, then closes; the
  big screen plays it after the welcome with the way in beside it, and the
  bell ends it.

## v0.19.0 — Your host tonight · 2026-10-20 08:45

**Why:** a TV game night needs a host. The big screen had the show and the
sound effects, but nobody was talking to the room. Nobody called the
questions, built up the answer or reacted to the evidence.

**Added**
- **A game-show host on the big screen.** Amy is an ElevenLabs voice
  ("cheerful and friendly Aussie presenter", model `eleven_v4`). She hosts
  from the TV only, with 47 recorded lines. The clips are in
  `client/public/voice/` (3.4 MB); the script is `client/src/hostLines.ts`.
  - Homeroom: she welcomes the room as soon as the TV has sound.
  - The bell: she opens the period.
  - Every question: she calls it as it lands ("Question four! It's getting
    harder.").
  - The clock: "Five seconds!" while someone is still thinking, and "Pencils
    down!" on hard questions.
  - **The answer: "The answer is... B!"** The letter lands as the answer
    lights up (within 10 ms in testing). Quick reveals, which leave too little
    runway for the long line, get a short "It's... B!".
  - The evidence card: a line for each kind. Each quip plays once per period;
    "close to the line" and "cleared" play every time.
  - On the first reveals she says how to accuse, until someone does.
  - The vote, its five-second warning, the verdict, a warning when the class
    has one strike left, the end of the period, and graduation day.
- **What she never does:** read a question out (players read at their own
  pace, and a spoken question would favour whoever sits nearest the TV), or
  say anything the screen doesn't show. Phones never download a clip.
- **One voice at a time.**
  - A headline cuts in, but she gets to finish a sentence that ends within
    about 2 seconds.
  - An aside ("Five seconds!") speaks only into silence.
  - A follow-up still waiting when the screen changes is dropped.
  - The sound effects duck under her voice, and every line is
    loudness-matched as it loads.
- **V** on the TV's keyboard mutes her (remembered). The TV hint now reads
  "Click or press any key for sound and your host".
- **`npm run host-voice`** (`tools/host-voice.mjs`) plays one period on a TV
  and prints the host's lines next to the screens. It times each answer call
  against the answer lighting up and checks that she never talks over
  herself. `-- --fast` plays a teacher who never waits.
- Test: "big screen: a game-show host voices the night, from the TV only".
  `npm run game-night` also checks her now: she opens both periods, calls
  answers and crowns the day, and no phone says a word.

**Changed**
- **With a big screen in the room, the bell holds 6.4 s instead of 3.2 s.**
  Before, her intro ran 5 seconds into question one and "Question one!"
  never came. Rooms without a TV are unchanged.

## v0.18.0 — Game night ready · 2026-10-20 07:13

**Why:** sixteen versions in one night, each tested on its own. Before anyone
hosts a real evening, the whole product has to work at once: three phones, a
TV, an accusation, a teacher whose page reloads, two periods, the end of the
day and the start of a new one.

**Added**
- **`npm run game-night`** (`tools/game-night.mjs`) plays a whole evening on
  one relay: teacher Hana, Bea, Cy, two bots and a big screen.
  - Period 1: Cy accuses after the first reveal and the class votes.
  - Period 2: the teacher's page reloads on the first question.
  - Then End the day, and New day.
  - It checks that every screen, the big screen included, reaches every phase
    with the same class, and that nothing throws a page error.
- **The big screen rolls long screens by itself.** A TV has no thumb to scroll
  with. Homeroom with the rules, the period's report and graduation day now
  roll slowly to the bottom once their show has landed, hold, then start
  again from the top.
- README: **Hosting a game night**, the evening in five steps: Wi-Fi, the
  QR, the big screen, reloads, practice.

**Fixed** (an independent code review of v0.12–v0.18 found these)
- **A reload on flaky Wi-Fi no longer ends the class.** The first failed
  connection used to throw the saved game away. Now the page tries again
  every few seconds while the relay holds the room. It only forgets the save
  when the relay says the room is gone.
- **A duplicated teacher's tab no longer splits the class silently.** The
  case: duplicating the tab to make a big-screen window. The copy takes the
  room. The original says "This classroom moved to another tab or device."
  and stops.
- **A closed room's game can't overwrite the next room's save.** A page that
  stops hosting now goes quiet.
- **The vote result no longer jumps when the verdict lands.** The box for the
  consequence is reserved from the first frame and reads "⚖️ The verdict
  decides what happens next…".
- **Your record counts a period once, even when you rejoin from a new tab.**
- **No repeated questions after the teacher's page reloads.** The list of
  questions already used is saved with the game.
- **How they played shows "—"** instead of "0.0s" when nobody answered.
- **The fine print lists every gold star,** including the cheater's +1 for
  lasting to Q10.
- **The big screen's sound turns on with any key,** not just a click, so a
  smart TV's remote works.

**Evidence**
- **`npm run game-night`:** 12 of 12 checks pass with no page errors on any
  of the four screens (three phones and a 1280×720 big screen). The first
  run's only failure was in the script, which counted a report card's rows
  before they had landed. It was not a game bug.
- **Balance re-check** with the simulator (`sim/tune-line.ts`, line 2100,
  two strikes, 200 matches per cell): a cheater who hides wins 34–56% at 6
  players, against a target of 35–55%. That is unchanged since v0.4. At 4 or
  8 players it's 31–60%, and built-in bots at 4/6/8 players win 27/37/46%.
  Fourteen versions of features didn't move the balance.
- **Big screen roll:** at 720p the lobby's scroll position, sampled every 2.5
  seconds, read 0, 0, 26, 101, 176 and 252. It waits 7 seconds, then rolls
  at 30 px/s.
- **The fixes:**
  - `sim/relay-check.ts` adds 3 checks: a second tab with the key takes the
    room, the first is told, and only the new host reaches the class. The old
    tab closing afterwards isn't mistaken for the host leaving.
  - `sim/resume-check.ts` adds one: a stopped host sends nothing, and its
    timers don't move the game.
  - The report-card phone test also closes Bea's tab and brings her back
    through the invite link in a new one. It still counts once.
  - Checked by hand: a duplicated teacher's tab takes the room and the
    original says so. A reload whose first three connections fail takes the
    room back on the fourth, 28 seconds in.
- The full suite passes.

## v0.17.0 — Called it · 2026-10-20 06:58

**Why:** the moment after the unmask is when a class decides whether to play
again. The report card showed scores, and the case file showed which
exhibits had been right. Neither answered the two questions everyone asks:
"how did they do it?" and "who saw it coming?". Answering both also teaches
deduction for next period. Principle 1: deduction must beat guessing.

**Added**
- **🔍 How they played**, a new card after the period's report card:
  - 🤫 **The cheater's record:** right answers out of the questions asked,
    and their median answer time.
  - 🏫 **The class's record:** how many the average classmate got right,
    and their median time.
  - 👉 **Called it:** everyone who was pointing at the cheater when the period
    ended, or "Nobody was pointing at them at the end."
- The figures come from the host (only it has every answer). They're
  published with the result, once the cheater is unmasked, so the card is
  the same on every phone and on the big screen.

**Evidence**
- `sim/yearbook-check.ts` checks both bot periods: the card counts the
  questions asked, and nobody gets more right than that. On the check's
  fixed seed:
  - Period 1: the cheater went 9/10 (4.2s median), the class 6.3/10 (5.9s).
  - Period 2: a careful cheater went 10/10 but slower than the class (6.3s
    vs 5.9s). That is the tell this card teaches people to read.
- The report-card phone test now also checks the card after the unmask.
- The full suite passes.

## v0.16.0 — The big screen · 2026-10-20 06:13

**Why:** at an in-person game night, the best moments happen when everyone
looks at the same grade book and points. Until now, each of those moments
lived on ten small screens. A TV or a laptop on the table can be the room's
shared stage.

**Added**
- **📺 Big screen.** On a TV or laptop, open the game at `#/tv/CODE` and that
  screen shows the whole show for the room:
  - the lobby, with a large QR code and the code to type
  - every question, reveal, vote, result and report card, on the same synced
    beats as the phones
  - the sound, from the best speaker in the room (after one click: browsers
    only start sound after a click, and the screen says so)
- The big screen is never a player: it takes no desk, never enters the
  hallway, is never the cheater, and gets only the public state. A classroom
  can have up to 3.
- The layout is the phone's, scaled to fit the screen, with nothing to tap:
  no answer buttons, no ACCUSE, no docks.
- The teacher finds the link on the QR card ("📺 Big screen? …"). The
  attendance shows a 📺 while one is watching.
- When the teacher's phone comes back from a reload (v0.14), the big screen
  rejoins by itself.

**Evidence**
- `sim/hallway-check.ts` gains 5 checks:
  - a big screen joins with no player id, no desk and no hallway place
  - it is never told it's the cheater
  - a classroom takes at most 3
  - one that leaves stops counting
- New phone test: a 1280×720 "TV" joins a classroom. It shows the QR and the
  code, and none of the invite buttons. The teacher sees a 📺 and still one
  desk taken. The TV follows the period to the reveal with no answer buttons
  and no ACCUSE, and the teacher's grade book still has three rows.
- Screenshots at 1920×1080 (lobby, role, question, reveal). The column
  scales 1.23×, a six-player reveal fits on screen, nothing scrolls
  sideways, and there are no page errors.
- Checked by hand: when the teacher's page reloads, the 📺 comes back and the
  big screen keeps following the class. Removing a bot afterwards took its
  list from 6 rows to 5.
- The full suite passes.

## v0.15.0 — Fresh eyes · 2026-10-20 05:58

**Why:** after fourteen versions of features, I had an independent reviewer go
through every screen at phone size with no context, the way a first-time
player would. They came back with 14 concrete problems. The worst three:
- On an iPhone SE, the prime suspect's name shrank to one letter on the
  reveal.
- The period's results ranked a caught cheater #1.
- A wrong detention's consequence (the line dropping) played under the
  Continue button.

**Fixed**
- **Reveal:** on phones narrower than 400px the score bar gives up room, so
  names stay readable. The prime suspect shows "Priy…" instead of "P…".
- **Vote:** a classmate's clues wrap to a second line instead of being sliced
  off at the card's edge. "Plurality goes to detention" now reads "Most
  votes → detention".
- **Exhibits:** "Pencil never stopped" gets its own ⏱️. ⚡ already meant
  "fastest right answer" on the grade book, so a harmless fast answer looked
  like evidence.
- **Report card:** the period's report card lists the winners first. A caught
  cheater no longer ranks #1, above the class that beat them.
- **Vote result:** the consequence (the line dropping, the strike, "case
  closed") shows right under the verdict, not below ten ballots. The stamp
  reads "Innocent!" instead of a second ✗.
- **Final blow:** it reads "✓ Antonio Vivaldi · 2.2s" instead of cutting the
  answer off at "answered “Antonio Vi…”".
- **Small labels:**
  - While the show runs, ACCUSE says "Grading…", which fits the teacher's
    three-button dock. "Watch the boa…" did not.
  - The strike boxes next to GRADE BOOK are labeled "strikes".
  - The lobby shows one "printing" message, not two.

**Changed**
- **Gold stars ⭐.** The day's points were "semester points", "pts" and
  "Semester standings", while "pts" also meant 100–400 per question. Now they
  are gold stars:
  - The ⭐ tab (it was 🎓, which also marks the graduation line) opens
    "Today's gold stars".
  - The podium says "2 ⭐".
  - How to play's fine print says how you earn them.
- **Names:** Home's lifetime card is now "📒 Your record", so "report
  card" only means one period's results.
- **Session end:** "🚪 Leave class" is a quiet secondary button. It used to be
  a red "Back to school" that looked like the next step. For classmates,
  "Share the day" leads.
- **Home:** "Practice with bots" now looks like a button (dashed outline).

**Removed**
- The "offline questions" chip on the reveal. Since v0.9 the built-in pack has
  been a feature, not a fallback, and players read the chip as a connection
  problem.
- "⬇ Match log" and "⬇ Download session log" for every teacher. They are
  playtest tools and now need `?playtest` in the URL. "End the day" gets the
  full width.

**Not taken**
- **The lobby clock "🕘 8:59"** stays. It's the minute before the bell, not a
  countdown.
- **A legend for ①②③** isn't needed: they only appear on the answers, in
  answer order.
- **Wrapping long podium names** would move the podium mid-animation.

**Evidence**
- Screenshots at iPhone SE size, before and after, of each fixed screen.
- Phone audit (7 phone sizes, 98 checks): no new sideways overflow and no
  new small tap targets. The vote needs a little more scrolling on the
  smallest phone (1st-gen SE), because clues now wrap instead of being cut
  off.
- The full-session smoke run passes with no errors.
- The full suite passes.

## v0.14.0 — The unkillable host · 2026-10-20 05:13

**Why:** the whole game lives in the teacher's page. Until now, a single
pull-to-refresh, a browser crash, or a phone that threw a background tab away
(iPhones do this often) ended the class for everyone, mid-period, and the room
was gone.

**Added**
- **The teacher's page can reload without ending the class.** After every
  change, the game is saved in that browser tab; nothing leaves the phone.
  When the page comes back, it takes its classroom back by itself: same code,
  same period, same scores, the same secret cheater. The timers carry on
  where they were. The class sees "📵 The teacher's phone dropped out" for a
  moment, then carries on.
- This works within the 90 seconds the relay holds a room, which covers a
  reload, a crash, or a tab the browser restores. "Back to school" (leaving on
  purpose) forgets the save.

**Unchanged on purpose**
- The teacher's page still asks before leaving mid-game. A reload is safe
  now, but closing the tab still ends the class once the 90 seconds run out.

**Evidence**
- `sim/resume-check.ts` (in `test:e2e`) plays bot periods on the real engine
  and "reloads" the host at every phase: role, question, reveal, vote, vote
  result, report card, homeroom. Each time, the restored host shows exactly
  the same state, keeps the same cheater, and plays on: to the end of the
  period, back to homeroom, or into the next period. A save is about 5–10 KB.
- New phone test: the teacher reloads mid-question. The page comes back to
  the same period, not the home screen. Bea's phone recovers by itself, both
  answer, the reveal reaches both, and the grade book shows the same four
  seats with Bea connected.
- Checked by hand: after a reload the teacher is back in the same room with
  its five bots. After leaving on purpose they land on Home and the save is
  gone; a last pagehide can't write it back.
- The full-session smoke run passes with no errors.
- The full suite passes.

## v0.13.0 — Rules at a glance · 2026-10-20 04:58

**Why:** How to play was seven paragraphs, and nobody reads seven paragraphs
on a phone in a noisy room. First-timers learned the rules from Teacher's
notes during the first period, so the lobby, where they wait with nothing to
do, taught them nothing.

**Changed**
- **How to play is four cards**: ✏️ 10 questions · 🤫 One cheater (the dot,
  the line) · 👀 Watch the board (point 👉) · 🙋 Accuse (and the strikes).
  The fine print (the line drop, CLEARED, top of the class) follows in three
  short lines. Every number comes from this class's settings, so a custom
  line or strike count is what the cards say.
- **It opens by itself for a first-timer**, meaning a phone with no report card
  yet. Everyone else gets it closed, as before.

**Removed**
- The seven-paragraph rules block.

**Evidence**
- Screenshots at iPhone SE size; nothing scrolls sideways.
- Phone audit across 7 phone sizes and 98 screen checks. The only change is a
  longer lobby for a first-timer: 2.4 → 3.2 screens on an iPhone SE, because
  How to play starts open. Start stays on screen, and there are no new small
  tap targets.
- The full suite passes (37 tests).

## v0.12.0 — Your report card · 2026-10-20 04:13

**Why:** a party game is played across many nights, but nothing remembered you
between them. Your best moments ("Detective ×3", "got away with it twice")
vanished when the tab closed.

**Added**
- **📒 Your report card** on Home, once you've played. It shows periods, wins,
  times you were the cheater and how often you got away with it, cheaters
  caught, times wrongly detained, and your most-earned superlatives. It's kept
  on this phone only and never sent anywhere.
- Each period counts once, from the public result. A reload, a late join or a
  New day never double-counts, and the hallway doesn't count.

**Evidence**
- A new phone test plays a period with three phones: Bea is the cheater, and
  the class catches her after Q1. Bea reloads on the report card. A fresh
  tab on each phone then shows "1 period": Bea has "1 time the cheater", Cy
  has "1 cheater caught".
- Screenshots at iPhone SE size, closed and open; nothing scrolls sideways.
- The full suite and the full-session smoke run pass.

## v0.11.0 — Fair start · 2026-10-20 03:58

**Why:** the cheater's first game decides whether the game works at all, and
nothing told a first-time cheater how they see the answers. A cheater who
missed the faint dot played as an innocent, and the class had nobody to catch.
Solo players also couldn't practice being the cheater: the role is random, 1
in 6.

**Changed**
- The cheater's note now reads **"It's you. Find the dot. 🤫"**. It's exactly
  as long as the innocent's note, so the boxes stay identical (parity).
- How to play says how the cheater sees answers: a faint dot in the corner of
  the right one. *Who* the cheater is stays secret; how the trick works never
  was.

**Added**
- **Practice as 🎲 Random / 🕵️ Innocent / 🤫 Cheater**, in a room where
  everyone else is a bot (there's nobody to deceive). The choice is ignored
  the moment another person is in the class.
- Dialogs take focus when they open (the 👉 sheet, the QR card, the standings
  sheet) and give it back when they close, for keyboards and screen readers.
- **The playtest report measures the new features.** `sim/report-logs.ts`
  now reports:
  - points per match, and who pointed
  - how accurate the class's pointers were at the end
  - how often detention went to the most-pointed-at classmate
  - wrong detentions per match, and strike-outs

  On 200 simulated bot matches: 71% of final pointers on the cheater, 94% of
  detentions to the top-pointed.

**Fixed**
- Back in homeroom, players sent to detention last period no longer wear a
  stale DETENTION badge. Per-period flags (detention, accusation used,
  pointer) are cleared on the way back and on New day. This bug was there
  since v0.1.
- **Nine fixes from a code review of v0.4–v0.10:**
  - A phone that drops out while waiting in the hallway keeps its place and
    comes back as the same person. If the place lapsed, or the host cleared
    the seat, the phone now follows its new seat instead of a stale one.
  - The vote's gavel, the period's ending sting and the day's fanfare play on
    the shared clock, so every phone plays them together. They used to play
    whenever each phone's packet landed. The fanfare now waits for the
    valedictorian stamp.
  - A quick change of 👉 suspect is never dropped: the latest one counts, and
    the class sees it within a third of a second.
  - "Copied. Paste it in the group chat!" now shows on the yearbook screen.
    It only ever showed in the lobby.
  - Add bot can't overfill a room whose hallway is full. A name waiting in
    the hallway can't be taken at the report card. If a start falls through,
    the hallway takes its seats.
  - After a New day, the first question no longer risks keeping your pick
    from day 1. The playtest log no longer files day 2's periods under day
    1's numbers, which used to drop their reveals.
  - The "Let them dig" superlative counts the real number of wrong
    detentions. It always said two.
  - On the host's phone, a ballot handing itself in could start a render
    inside a render. Renders now queue.

**Removed before shipping**
- "Bot smarts" (Easy / Normal / Sharp). The simulator showed that "sharp" bots
  made the cheater win *more* (49–66% vs 30–43%): with two strikes, quick-to-
  accuse bots send innocents to detention. A misleading label, so it didn't
  ship.

**Evidence**
- `sim/practice-check.ts` (6 checks, in `test:e2e`): the choice is honoured
  in practice rooms and ignored as soon as another human is present.
- `sim/hallway-check.ts` grows to 17 checks: the same id after a drop-out, a
  lapsed place isn't seated, the full room, the name at the report card, and
  a quick change of suspect. `sim/yearbook-check.ts` plays a period on day 2
  and checks that the log counts periods 1, 2, 3. Each new check fails on
  v0.10.
- Earlier Playwright runs (v0.3–v0.10) reused a local server started before
  v0.3.0, so they ran against the old relay. `sim/relay-check.ts` always
  tested the current relay. From v0.11 on, the suite gets a fresh server.
- The phone audit shows no regressions since v0.3.0.
- The QR test now checks focus.

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
