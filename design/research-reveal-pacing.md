# Reveal pacing brief: game shows, party games, social deduction, suspense research

**Labels:** **M** = measured data from an empirical study. **D** = a documented rule, setting or production convention. **I** = my own inference. All URLs were checked in this session. Wherever I write "not found", the number was not available in any source I could reach.

## (a) Reference timings

| Reference | Timing / fact | Type | Source |
|---|---|---|---|
| Millionaire (US clock format, 2008–10) | 15s for Q1–5, 30s for Q6–10, 45s for Q11–14; the time allowed rises with the stakes | D | https://en.wikipedia.org/wiki/Who_Wants_to_Be_a_Millionaire_(American_game_show) |
| Millionaire (UK) | Music plays the whole episode and rises one semitone per question, across 3 variations. Extra lighting effects at higher prize levels. The rig can narrow from the full set to just host and contestant. The host only sees the answer after "final answer" | D | https://en.wikipedia.org/wiki/Who_Wants_to_Be_a_Millionaire%3F_(British_game_show) |
| Millionaire hold from lock-in to verdict | **No duration found.** Tarrant says he put ad breaks between the final answer and the verdict on purpose | D | https://www.aol.com/chris-tarrant-shares-huge-want-103425285.html |
| Family Feud | Face-off: 3s to answer. Fast Money: 20s and 25s. Point values double, then triple, in later rounds, with fewer answers on the board. **How long each board reveal lasts: not found** | D | https://en.wikipedia.org/wiki/Family_Feud |
| The Chase | Cash Builder 60s. In Head-to-Head, once one side locks in, the other has 5s. Final Chase 120s | D | https://en.wikipedia.org/wiki/The_Chase_(British_game_show) |
| Among Us defaults | 15s of discussion before voting opens, then 120s to vote (people keep talking). Confirm Ejects on, votes not anonymous. Results appear once everyone has voted or the timer ends. **Ejection screen length: not found** | D (community protocol doc, not Innersloth) | https://github.com/roobscoob/among-us-protocol/blob/master/07_miscellaneous/01_the_structure_of_the_gameoptionsdata_object.md, https://www.pcgamesn.com/among-us/update-meeting |
| Town of Salem | 45s discussion, 30s defense, 5s last words. These figures may be out of date; **the judgement timer was not found** | D | https://en.everybodywiki.com/Town_of_Salem |
| Ultimate Werewolf | The rulebook's example day limit is 5 min, with a warning before time runs out. Wolves get 30s to agree on a target. Roles are revealed on elimination. The rulebook recommends talking right after the game | D | https://rulespal.com/ultimate-werewolf/rulebook |
| One Night Ultimate Werewolf: Epic Battle | Shorten discussion as players get experienced, because time pressure adds tension | D | https://rulespal.com/one-night-ultimate-werewolf-epic-battle/rulebook |
| Jackbox | Timers were extended for stream delay. A developer said going any longer dragged while everyone waited on unresponsive players. **Reveal durations for Fibbage, Quiplash and Trivia Murder Party: not found in any official source.** A GDC 2021 talk exists, but I could not access its content | D | https://steamcommunity.com/app/331670/discussions/0/611698195168609949, https://gdcvault.com/play/1027202/The-Jackbox-Party-Pack-Unboxed |
| Twitch | Developers were told to assume about 10s of stream delay | D | https://discuss.dev.twitch.tv/t/reduce-broadcast-delay/5254 |
| Conversation turn gaps | Across 10 languages, average gaps fall within 250ms of the shared mean. Each language's most common gap is 0–200ms | M | https://forms.mpi.nl/node/50939, https://languagelog.ldc.upenn.edu/nll/?p=7997 |
| Silence | Silences around 1s start to read as "trouble" | M (observational, conversation analysis) | https://emcawiki.net/Jefferson1989a |
| Laughter | A laugh bout lasts about 1s: roughly 4.4 pulses of 0.11s each, separated by 0.12s gaps | M (as reported in a review) | https://arxiv.org/pdf/1010.5602 |
| Voice latency | Under 150ms one-way feels seamless. 400ms is the planning ceiling | D (ITU-T standard) | https://www.cs.columbia.edu/~andreaf/new/documents/other/T-REC-G.114-200305.pdf |
| Comedy craft | Pick up the next line when the laugh starts to fade, not after it has died completely | D | https://en.wikipedia.org/wiki/Comic_timing |

**Psychology findings (all M):**
- **Teasing effect:** across 7 studies, revealing trivia information in two steps was enjoyed more than revealing it at once, even though people *choose* the all-at-once version. https://iro.uiowa.edu/esploro/outputs/journalArticle/The-Teasing-Effect-An-Underappreciated-Benefit/9984380448802771
- **Uncertainty intensifies feelings:** in 4 studies, feeling unsure made pleasant moments more pleasant and unpleasant ones worse. https://scholar.harvard.edu/files/danielgilbert/files/gilbert_feelinguncertaintyintensifies.pdf
- **Waiting:** a 30-minute wait made chocolate more enjoyable and prune juice less enjoyable. https://blogs.wpcarey.asu.edu/20050506-waiting-game-its-not-always-bad-thing
- **Breaks restore enjoyment:** commercial interruptions restored enjoyment of TV by interrupting adaptation. https://acawiki.org/Enhancing_the_Television-Viewing_Experience_Through_Commercial_Interruptions
- **Satiation depends on pace:** variety beats repetition when things come back-to-back. Spacing them out cuts satiation. https://dlab.sauder.ubc.ca/sjdm/journal/11/10624/jdm10624.html
- **Peak-end:** a meta-analysis of 174 effects found the peak and the ending strongly predict how an experience is remembered (r = 0.581). Duration had almost no effect. https://psychology.gmu.edu/defenses/1259
- **Close games:** fans of the winning side who at some point expected to lose rated the game most suspenseful. N = 113. https://deepblue.lib.umich.edu/handle/2027.42/78673
- **Suspense theory** (formal model, not data): suspense equals the variance of what people will believe next. The suspense-maximizing schedule holds suspense constant, leaves the outcome open until the final period, and makes swings larger but rarer as time goes on. https://pdfs.semanticscholar.org/827b/8d5f516a8631cfa9c7ea3d1f5507a3c566f9.pdf

I could not get the numbers from Lang et al. (1999) on TV editing pace and habituation.

## (b) Principles for a reveal that repeats about 50 times per session

1. **Spend drama only where the outcome is uncertain.** If everyone picked the same correct option, nobody's belief can change, so there is no suspense to build. Run those reveals in about 2–3s (I). Save the drumroll for a lone correct answer on a hard question, a split room, or someone near the threshold. (Ely et al.)
2. **Step up the ceremony with each difficulty tier.** Millionaire raises the clock (15→30→45s) and the music pitch as stakes climb, and Family Feud doubles then triples values. Map easy/medium/hard to three intensity levels, with a small audio step on every question (I). (Millionaire, Family Feud)
3. **Reveal in at least two steps: picks first, then the answer.** The teasing effect and the uncertainty finding both support it. People still say they'd rather have it all at once, so keep the host's skip button. (Ruan; Bar-Anan)
4. **Don't hold before an outcome the room already knows.** Waiting makes a pleasant outcome better and a dull or unpleasant one worse. Drop the drumroll when the answer is obvious (I). (Nowlis)
5. **Fight repetition fatigue with variety, not length.** Never fire the same type of callout twice in a row. Let the vote and match-end screens act as breaks. (Galak; Nelson/Meyvis)
6. **Budget for the peak and the ending.** Total length barely affects how players remember a match. Put the full ceremony on Q8–10 and the match end, and trim Q1–3 hard. (Peak-end meta-analysis)
7. **Size the talk hold for a voice call.** Allow the 1s silence that invites someone to speak, plus up to 2×400ms of latency, plus reaction time. That gives at least 2–3s of hold after the evidence beat, with the accuse button already live (I). Never advance while people are laughing. (Jefferson; G.114; comic timing)
8. **Make "pencils down" a clear sensory cue.** Millionaire marks the lock-in with a lighting and music change. Use one shared sound plus a haptic pulse on every phone. (Millionaire UK)
9. **Make evidence compare players.** The Jack Principles want the program to appear aware of how different users acted compared with each other, and to avoid repeating its own lines. "Only Bob got it" and "1.2s, fastest by 4s" do exactly that. (https://karlkapp.com/creating-a-natural-engaging-conversation-in-your-simulation-or-game/)
10. **Move on instead of waiting forever.** Use a short fixed beat, then hand the host an open window: this matches Among Us's 15s discussion followed by 120s voting, and Jackbox's view that longer timers drag. (Jack Principles; Steam thread; Among Us)
11. **Show every vote at once with names attached, then hold for talk.** Among Us shows who voted for whom, and Werewolf says much of the fun is the talk after the game. The match-end screen needs its own talk hold. (Among Us; Ultimate Werewolf)
12. **Give full drama when someone is close to the threshold.** In the sports study, close games produced the most suspense. Trigger it when any player is within one question's points of the line (I). (Knobloch-Westerwick)