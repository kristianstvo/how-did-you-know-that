# Product

How the game is being steered: what it is for, the rules I decide by, what's
next, and every product decision with its evidence. Version details:
`CHANGELOG.md`.

## North star

Spec 00's success criterion: **"No way you knew that!"** accusations happen on
their own, in a 3–4 minute match, with phones in hand.

## Principles

1. **Deduction must beat guessing.** No strategy that ignores the evidence may
   do better than one that reads it.
2. **Every phone sees the same show.** Cheater and innocent screens are
   identical except the marker (parity test), and beats land together (sync test).
3. **Phone first.** Controls in thumb reach; works on an iPhone SE, on cellular,
   through a screen lock.
4. **Measure, change, measure.** Balance through the simulator, layout through
   the phone audit, behaviour through end-to-end tests. Gut feel only picks what
   to measure next.
5. **Easy to undo.** Every version is a tag; anything can be rolled back.

## Roadmap

| Version | Theme | Status |
|---|---|---|
| v0.3.0 | Phone play | shipped |
| v0.4.0 | Balance: two strikes, line 2100 | shipped |
| v0.5.0 | Point at a suspect: free, public, changeable, before spending your accusation | shipped |
| v0.6.0 | Game-show sound: synthesized, synced to the beats, one switch | shipped |
| v0.7.0 | First game night: Teacher's notes, the hallway for late arrivals, Practice with bots | shipped |
| v0.8.0 | The yearbook: superlatives every period, the day's yearbook, Share the day | shipped |
| v0.9.0 | Question bank 2.0: 189 curated questions, a fetcher that stops getting rate-limited | shipped |
| v0.10.0 | Hosting made easy: pace presets, New day same class, clear a seat | shipped |
| v0.11.0 | Fair start: the cheater learns the dot, Practice as a chosen role, dialog focus | shipped |
| v0.12.0 | Your report card: each phone remembers its record across days | shipped |
| v0.13.0 | Rules at a glance: four cards, open for first-timers | shipped |
| v0.14.0 | The unkillable host: a reload takes the class back | shipped |
| v0.15.0 | Fresh eyes: an independent review's fixes; ⭐ gold stars | shipped |
| v0.16.0 | The big screen: a TV or laptop shows the show for the room | shipped |
| later | A big-screen layout that uses the width (side-by-side reveal) | ideas |

Later versions take the best of what playtests and audits turn up.

## Decision log

| Version | Decision | Why / evidence |
|---|---|---|
| v0.3.0 | ✅ Voting becomes pick, then Hand in (one-tap voting removed) | A mis-tap among ten names wasted the only vote; the pick still goes in by itself before the bell |
| v0.3.0 | ✅ The separate name field on Home removed: you write on the sticker | Saved a row; Join/Create now fit on an iPhone SE |
| v0.3.0 | ✅ Host dropout grace (90s) instead of host migration | Covers screen locks and app switches at a fraction of migration's complexity |
| v0.4.0 | ✅ Two strikes: the 2nd wrong detention graduates the cheater | Blind "everyone in turn" sweeps went from beating deduction (cheater 30–50%) to losing (62–80%, 5–10 players); deducing classes strike out in ≤3% of matches |
| v0.4.0 | ✅ Default line 1400 → 2100 | Under two strikes, a cheater who hides wins 81–97% at 1400 and 34–56% at 2100 (target 35–55%); most cheater wins are still dramatic late graduations |
| v0.4.0 | ❌ One accusation per question (as the sweep fix) | No effect at 4–6 players: the 1-vs-1 tie at the end decides the sweep, not timing |
| v0.4.0 | ❌ No accusations before Q4 | A blind sweep still won 51% at 6 players |
| v0.4.0 | ❌ Spyfall rule (one wrong detention = cheater wins) | Makes every early accusation all-or-nothing; two strikes already kills the sweep |
| v0.5.0 | ✅ Pointing at a suspect, attributed (everyone sees who points at whom) | Attribution starts conversations, the same reason spec 03 reveals who voted for whom; anonymous counts would hide the social signal |
| v0.5.0 | ✅ Detention players may point | They lose their vote, not their voice; keeps them in the game |
| v0.5.0 | ❌ Pointing UI on the question screen | The question screen stays about the question; pointing lives on the reveal, where the talking happens |
| v0.5.0 | ❌ A cost or a limit on pointing | It must be cheaper than an accusation to do its job; a 350ms flood guard is the only limit |
| v0.6.0 | ✅ Synthesized sound instead of recorded samples | Nothing to download or license, instant on cellular, and every sound is tunable in code |
| v0.6.0 | ✅ Sound on by default, one switch per phone, "ambient" on iOS | The show needs it; the silent switch and voice calls are respected, and anyone can turn it off in one tap |
| v0.6.0 | ❌ Role-specific sounds | A different sound for the cheater would be a tell across the room (parity) |
| v0.7.0 | ✅ Teach inside the game, not before it | Nobody reads a rules block on a phone; Act I's empty evidence slot teaches one thing per reveal, first period only |
| v0.7.0 | ✅ Late arrivals watch from the hallway instead of being turned away | Someone is always late; watching a period teaches them the game, and they can never be the cheater mid-period |
| v0.7.0 | ✅ One-tap Practice with bots | Solo tryouts were five taps of setup; bots were already there |
| v0.7.0 | ❌ Seating late arrivals mid-period | They'd miss the role and start behind; a fresh seat next period is fair |
| v0.8.0 | ✅ Awards computed by the host and published with the result | Every phone shows the same yearbook (parity), and only the host has the full answer history |
| v0.8.0 | ✅ At most 4, one per person | More would be noise; spreading them lets more people feel seen |
| v0.8.0 | ❌ Harsh awards | Party games roast lightly; "Last pencil down" is as mean as it gets |
| v0.9.0 | ✅ Curate 104 questions by hand rather than pull more from the API | Quality and the points ramp (easy must really be easy) matter more than volume; the API stays for variety |
| v0.9.0 | ✅ Start wait 8s → 3s | Waiting 8s for one or two online questions wasn't worth it once the pack could cover a whole period |
| v0.9.0 | ❌ Drop the online questions entirely | They add thousands of questions of variety; with the queue fixed they are a good second source |
| v0.10.0 | ✅ Presets change the pace only | The line and strikes are balance (simulated); a preset that quietly changed them would undo v0.4's tuning |
| v0.10.0 | ✅ New day keeps the room and the code | Rejoining with a new code was the biggest reason a good night ended |
| v0.10.0 | ❌ Kicking someone who is still connected | Too easy to abuse in a party game; only seats of people who left can be cleared |
| v0.11.0 | ✅ Tell the cheater how they see answers | The mechanic isn't the secret, the identity is; a cheater who misses the dot breaks the game |
| v0.11.0 | ✅ Choose your role, but only with bots | Practicing the cheater role needs it; with any other human it would be cheating |
| v0.11.0 | ✅ Every sound waits for its beat on the shared clock, never for a packet | A gavel landing 200ms apart on ten phones sounds like a glitch; the motion was already synced, the sound now is too |
| v0.11.0 | ❌ Bot smarts (Easy / Normal / Sharp) | Simulated: "Sharp" (more accusations) made the cheater win more under two strikes; Easy ≈ Normal. Built, measured, not shipped |
| v0.12.0 | ✅ The report card lives on the phone only | No accounts, nothing sent anywhere; a party game must start in seconds, and your record is nobody else's business |
| v0.12.0 | ✅ Counted from the public result, once per period | The secret never leaves the host, and a reload or a rejoin can't count a period twice |
| v0.12.0 | ❌ Accounts or a cloud profile | A sign-up wall in front of a party game costs more players than a record across phones would win |
| v0.13.0 | ✅ Four cards, then the fine print | Ten seconds of reading covers the game; the edge cases stay one glance away |
| v0.13.0 | ✅ Open by itself only for a first-timer | The lobby is where a newcomer waits with nothing to do; regulars don't need it in their way |
| v0.13.0 | ❌ A tutorial before the first game | It delays the start for everyone; Teacher's notes (v0.7) already teach inside the first period |
| v0.14.0 | ✅ Save the whole game in the teacher's tab, not on the server | The relay stays dumb (spec 05) and the secret never leaves the host's phone; a reload is the common failure |
| v0.14.0 | ✅ Keep the "Leave site?" prompt for the teacher | A reload is safe now, but closing the tab still ends the class after 90 seconds |
| v0.14.0 | ❌ Host migration (another phone takes over the game) | It needs the secret on a second phone; saving the game covers reloads and crashes at a fraction of the risk |
| v0.14.0 | ❌ A pause button | The reveal, the vote result and the report card already wait for the teacher's tap; the timed bits are 3–30 seconds |
| v0.15.0 | ✅ An independent, no-context review of every screen | The builder stops seeing what a first-timer trips on; one pass found 14 concrete problems, 3 of them serious |
| v0.15.0 | ✅ Gold stars ⭐ as the day's unit | "pts" meant two different things; a teacher's gold star is on theme |
| v0.15.0 | ✅ Playtest tools behind `?playtest` | Event-log downloads are for tuning the game, not for a class at a party |
| v0.15.0 | ❌ Custom questions written by the teacher | The teacher always plays: they'd know every answer, and their own lone right answers would read as cheating |
| v0.16.0 | ✅ The big screen reuses the phone layout, scaled | Every screen and beat already works and is tested; a TV-specific layout is a later step, not a prerequisite |
| v0.16.0 | ✅ A big screen is never a player | It can't hold a secret or a vote, so it can't change the game: parity and balance are untouched |
| v0.16.0 | ❌ Making the big screen required | Phone first: the game must stay complete on phones alone, for remote classes on a call |
