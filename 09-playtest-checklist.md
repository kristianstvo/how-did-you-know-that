# 09 — Playtest checklist

The simulator can predict the mechanics, but it can't predict people. This
checklist turns a real session into data you can compare against the
simulation (see 08 §1 and §7). Success, in spec 00's words: accusations along
the lines of **"no way you knew that!"** happen on their own.

## Setup (10 minutes)

- **Players:** 4–8, ideally including at least two people who aren't you or
  your usual group (spec 00: "strangers to the dev"). Run 3 matches or more,
  with each person on their own phone and everyone on one voice call.
- **Lines:** play 2 matches at the default (line 2100, two strikes), then 2
  matches at **1800** (Lobby → Class rules). The simulator predicts a cheater
  who hides wins 34–56% at 2100 and 64–84% at 1800.
- **Rules:** give one rules explanation only, the in-lobby "How to play".
  Answer no questions during play; write them down instead.
- **Logging:** the host presses **⬇ Download match log** after every match (on
  the report-card screen) or once at session end.

## What to record

1. **Call audio.** Record the voice call with everyone's consent. It's the
   rawest material you'll get.
2. **The host's screen**, as a phone screen recording.
3. **The event logs** (JSONL), downloaded from the host's report card.

## Moments to tag

Note the audio time for each, then line it up with the log.

| Tag | Listen for | Why it matters |
|---|---|---|
| **ACC** | Anyone saying "how did you know", "no way", "sus", or naming a suspect, *before* anyone taps ACCUSE | The success criterion |
| **BEAT** | Which reveal beat it followed: answer, verdict/times, exhibit card, grade book, LAST BELL, CLEARED | Shows which beats provoke talk; 08 predicts the exhibit card and LAST BELL |
| **SILENT** | A reveal that passed with nobody speaking | Possible fatigue; note which act |
| **CONFUSED** | "Wait, what happened?", or someone asking what a stamp means | Comprehension failures |
| **WAIT** | "Come on…", or anyone visibly waiting on the UI | Tempo problems; check the host's Skip usage |
| **PEEK** | Anyone noticing something on another person's screen | Parity or screen-share leaks |
| **DROP** | A "reconnecting" or "teacher's phone dropped out" banner: whose phone, why (lock, app switch, signal) and whether it came back | Phone resilience (10-phone-play.md) |
| **TELL** | The cheater, afterwards, describing what they did to blend in | Real cheater strategies, to check against the simulator's naive / mimic / careful / sprint |

## Afterwards (15 minutes)

1. Run `npx tsx sim/report-logs.ts <your logs>`. It prints the cheater win rate
   (with a CI), accusations per match, time to first accusation, provably-CLEARED
   banishments and the speed tell, beside the simulated band for your room size.
2. Ask everyone three quick questions:
   - "Which moment was the most fun?"
   - "When were you bored?"
   - "Did you ever feel sure who it was? Why?"
3. Ask each cheater: "What did you do on purpose to hide?"

## What counts as success

| Measure | Target | Source |
|---|---|---|
| ACC tags per match | ≥ 2, at least one before Q8 | Spec 00 |
| ACC tags that follow a reveal beat (not random) | Most of them | 08 §3 |
| SILENT reveals in Act III (Q8–10) | 0 | 08 §5 |
| CONFUSED tags | ≤ 1 per session after the first match | Spec 00 ("one rules screen") |
| Cheater win rate across the session | 35–55% (expect a wide CI) | The brief |
| Banishing a CLEARED player | Never | 08 §1 (the CLEARED stamp should prevent it) |
| PEEK caused by the UI (not by holding a phone up) | Never | Parity constraint |

If the cheater wins far more often than 55% at the default line, raise it (spec
02 allows "raise the threshold"); if they almost never win, lower it.
