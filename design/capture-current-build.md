# Current build baseline — capture report

Generated 2026-10-18T21:45:39.931Z by `tools/capture-current.mjs`. Microsoft Edge 155.0.4283.62, headless, viewport 380x800 @2x, isMobile+hasTouch, CPU throttle 4x on every page. Host context video-recorded.

Match: 4 players (Host, Player2, 2 host-side bots). Cheater: **Host (human)**. End: **🎓 The cheater graduated 🎓** after 8 reveals. Vote(s): player2 vote:Q2#1 -> "📚 Class Clown Cal"; host vote:Q2#1 -> "📚 Class Clown Cal"; host vote:Q4#1 -> "🎒 Sleepy Sam"; player2 vote:Q4#1 -> "🎒 Sleepy Sam"; result voteResult:Q2#1: 📚 Class Clown Cal was innocent! (−200! Cheater now graduates at 1200!); result voteResult:Q4#1: 🎒 Sleepy Sam was innocent! (−200! Cheater now graduates at 1000!). Offline-question chip shown: true. Run wall time 149.8s.

Caveats: headless Edge on a desktop CPU with Chrome's CPU throttle is a proxy for a mid/low-end phone, not a measurement of one; video recording and screenshots also cost frames. "Clean" frame numbers exclude frames within 50 ms before to 250 ms after any screenshot. Both contexts share one machine clock, so sync numbers are relay + render latency only (no clock skew).

## Frame timing (rAF intervals, clean)

**Host**

| phase | frames | mean fps | p50 ms | p95 ms | p99 ms | max ms | >18ms | >33ms | >50ms |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| home | 108 | 108 | 6.9 | 7 | 55.5 | 194.3 | 3 | 2 | 2 |
| lobby | 1303 | 144 | 6.9 | 7 | 7.1 | 7.2 | 0 | 0 | 0 |
| role | 372 | 144 | 6.9 | 7 | 7.1 | 7.1 | 0 | 0 | 0 |
| question | 7653 | 144 | 6.9 | 7 | 7.1 | 7.5 | 0 | 0 | 0 |
| question@entry2s | 1938 | 144 | 6.9 | 7 | 7.1 | 7.3 | 0 | 0 | 0 |
| reveal | 6697 | 143.6 | 6.9 | 7 | 7.1 | 111.2 | 1 | 1 | 1 |
| reveal@entry2s | 1949 | 142.8 | 6.9 | 7 | 7.1 | 111.2 | 1 | 1 | 1 |
| vote | 943 | 144 | 6.9 | 7 | 7.1 | 7.2 | 0 | 0 | 0 |
| vote@entry2s | 459 | 144 | 6.9 | 7 | 7.1 | 7.2 | 0 | 0 | 0 |
| voteResult | 609 | 142.8 | 6.9 | 7 | 7.1 | 34.7 | 1 | 1 | 0 |
| voteResult@entry2s | 502 | 142.6 | 6.9 | 7 | 7.1 | 34.7 | 1 | 1 | 0 |
| matchEnd | 393 | 140.8 | 6.9 | 7 | 7.1 | 55.5 | 2 | 1 | 1 |
| matchEnd@entry2s | 172 | 136.8 | 6.9 | 7 | 20.9 | 55.5 | 2 | 1 | 1 |
| sessionEnd | 278 | 142 | 6.9 | 7.1 | 7.1 | 34.7 | 1 | 1 | 0 |

**Player2**

| phase | frames | mean fps | p50 ms | p95 ms | p99 ms | max ms | >18ms | >33ms | >50ms |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| home | 72 | 99.7 | 6.9 | 7 | 187.5 | 187.5 | 2 | 2 | 1 |
| lobby | 1197 | 144 | 6.9 | 7 | 7.1 | 7.1 | 0 | 0 | 0 |
| role | 373 | 144 | 6.9 | 7 | 7.1 | 7.1 | 0 | 0 | 0 |
| question | 7650 | 144 | 6.9 | 7 | 7.1 | 7.5 | 0 | 0 | 0 |
| question@entry2s | 1932 | 144 | 6.9 | 7 | 7.1 | 7.3 | 0 | 0 | 0 |
| reveal | 6699 | 143.6 | 6.9 | 7 | 7.1 | 111.1 | 1 | 1 | 1 |
| reveal@entry2s | 1947 | 142.9 | 6.9 | 7 | 7.1 | 111.1 | 1 | 1 | 1 |
| vote | 943 | 144 | 6.9 | 7 | 7.1 | 7.2 | 0 | 0 | 0 |
| vote@entry2s | 458 | 144 | 6.9 | 7 | 7.1 | 7.2 | 0 | 0 | 0 |
| voteResult | 610 | 142.8 | 6.9 | 7 | 7.1 | 34.8 | 1 | 1 | 0 |
| voteResult@entry2s | 502 | 142.6 | 6.9 | 7 | 7.1 | 34.8 | 1 | 1 | 0 |
| matchEnd | 394 | 140.8 | 6.9 | 7 | 7.1 | 55.5 | 2 | 1 | 1 |
| matchEnd@entry2s | 173 | 136.9 | 6.9 | 7 | 20.8 | 55.5 | 2 | 1 | 1 |
| sessionEnd | 309 | 143.1 | 6.9 | 7.1 | 7.1 | 20.8 | 1 | 0 | 0 |

Host reveal including screenshot windows: 6824 frames, mean 143.6 fps, p95 7 ms, max 111.2 ms.

Measured vsync interval (median rAF delta): host 6.9 ms, Player2 6.9 ms (≈144.9 Hz — headless Edge follows this machine's display rate, so "mean fps" is capped there, not at 60).

**Screen-entry cost** — worst frame within 500 ms of each screen's DOM swap (clean). The first time a screen type renders it pays style/layout/emoji-raster cost; later instances are cheap.

| screen | host 1st instance worst frame ms | host 1st: DOM swap → next rAF ms | host later instances mean/max ms | P2 1st instance worst frame ms | P2 later mean/max ms |
| --- | --- | --- | --- | --- | --- |
| home | 194.3 | 179.4 | – | 187.5 | – |
| lobby | 7 | 142.5 | – | 7 | – |
| role | 7.1 | 31.2 | – | 7.1 | – |
| question | 7.1 | 31.7 | 7.2 / 7.3 (n=6) | 7 | 7.1 / 7.3 (n=6) |
| reveal | 111.2 | 107 | 8.1 / 13.9 (n=7) | 111.1 | 7.1 / 7.2 (n=7) |
| vote | 7.2 | 6.7 | – | 7.2 | – |
| voteResult | 34.7 | 36.5 | 7.5 / 7.5 (n=1) | 34.8 | 7.4 / 7.4 (n=1) |
| matchEnd | 55.5 | 60.8 | – | 55.5 | – |
| sessionEnd | 34.7 | 30.1 | – | 20.8 | – |

## Full #app re-renders (innerHTML replacement)

Every `state` and every `secret` message calls `render()`, which replaces all of `#app`. Counted per `innerHTML` assignment (MutationObserver record on `#app`), attributed to the screen showing when the observer fires.

| phase | host total | host instances | host per-instance mean/max | P2 total | P2 instances | P2 per-instance mean/max |
| --- | --- | --- | --- | --- | --- | --- |
| home | 1 | 1 | 1 / 1 | 3 | 1 | 3 / 3 |
| lobby | 6 | 1 | 6 / 6 | 5 | 1 | 5 / 5 |
| role | 2 | 1 | 2 / 2 | 2 | 1 | 2 / 2 |
| question | 42 | 7 | 6 / 6 | 49 | 7 | 7 / 7 |
| reveal | 21 | 8 | 2.6 / 4 | 14 | 8 | 1.8 / 2 |
| vote | 9 | 2 | 4.5 / 5 | 11 | 2 | 5.5 / 6 |
| voteResult | 4 | 2 | 2 / 2 | 2 | 2 | 1 / 1 |
| matchEnd | 3 | 1 | 3 / 3 | 2 | 1 | 2 / 2 |
| sessionEnd | 1 | 1 | 1 / 1 | 1 | 1 | 1 / 1 |

Total full re-renders: host 89 (55 observer batches), Player2 89 (88 batches).

## CSS animations

**Host** — 14 animationstart events.

| phase | animation | starts |
| --- | --- | --- |
| reveal | shake on .btn.accuse.confirm | 1 |
| vote | slam on .accused-banner | 7 |
| voteResult | slam on .result-banner.wrong | 2 |
| voteResult | dropIn on .thr-drop | 2 |
| matchEnd | slam on .end-banner.cheater-win | 1 |
| matchEnd | pulse on .end-banner.cheater-win | 1 |

Restarted within one phase instance:

| instance | animation | element | starts | ms after phase start |
| --- | --- | --- | --- | --- |
| vote:Q2 | slam | accused-banner | 4 | 45.8, 1511.2, 1906.9, 2413.9 |
| vote:Q4 | slam | accused-banner | 3 | 17.6, 1288.5, 1517.5 |

**Player2** — 13 animationstart events.

| phase | animation | starts |
| --- | --- | --- |
| vote | slam on .accused-banner | 7 |
| voteResult | slam on .result-banner.wrong | 2 |
| voteResult | dropIn on .thr-drop | 2 |
| matchEnd | slam on .end-banner.cheater-win | 1 |
| matchEnd | pulse on .end-banner.cheater-win | 1 |

Restarted within one phase instance:

| instance | animation | element | starts | ms after phase start |
| --- | --- | --- | --- | --- |
| vote:Q2 | slam | accused-banner | 4 | 46.3, 1524.4, 1906.4, 2406.4 |
| vote:Q4 | slam | accused-banner | 3 | 17, 1281, 1530.9 |

Phases with **zero** CSS animations on the host: role, question.

## Transitions

**Host** — grade-book `.fill` width transition events: 0 (ran: **never**). Transition events of any kind: 0.


**Player2** — grade-book `.fill` width transition events: 0 (ran: **never**). Transition events of any kind: 0.


`.bar-row .fill { transition: width 0.6s }` is dead code: each reveal inserts brand-new bars already at their final width, so there is no "from" value to transition from.

## Long tasks (>50 ms main-thread)

| phase | host count | host total ms | host max ms | P2 count | P2 total ms | P2 max ms |
| --- | --- | --- | --- | --- | --- | --- |
| boot | 1 | 184 | 184 | 1 | 177 | 177 |
| lobby | 1 | 145 | 145 | 1 | 71 | 71 |
| reveal | 1 | 106 | 106 | 1 | 111 | 111 |
| matchEnd | 1 | 58 | 58 | 1 | 58 | 58 |

Totals: host 4 (493 ms), Player2 4 (417 ms).

| ctx | duration ms | during | ms after screen start |
| --- | --- | --- | --- |
| host | 184 | boot#1 | 14.6 |
| host | 145 | lobby#1 | 0.4 |
| host | 106 | reveal:Q1#1 | 0.4 |
| host | 58 | matchEnd#1 | 1.7 |
| P2 | 177 | boot#1 | 17.8 |
| P2 | 71 | lobby#1 | 0 |
| P2 | 111 | reveal:Q1#1 | 1.1 |
| P2 | 58 | matchEnd#1 | 1 |

## Layout checks at 380px

| ctx | phase | checks | horizontal overflow | max page height px | targets <44px | ellipsized texts |
| --- | --- | --- | --- | --- | --- | --- |
| host | home | 2 | no | 800 | 2 | 0 |
| host | lobby | 2 | no | 965 | 3 | 0 |
| host | role | 2 | no | 800 | 0 | 0 |
| host | question | 9 | no | 800 | 0 | 0 |
| host | reveal | 10 | no | 800 | 0 | 7 |
| host | vote | 4 | no | 800 | 0 | 2 |
| host | voteResult | 3 | no | 800 | 0 | 0 |
| host | matchEnd | 2 | no | 875 | 0 | 1 |
| host | sessionEnd | 2 | no | 800 | 0 | 0 |
| P2 | home | 2 | no | 800 | 2 | 0 |
| P2 | lobby | 2 | no | 800 | 1 | 0 |
| P2 | role | 2 | no | 800 | 0 | 0 |
| P2 | question | 9 | no | 800 | 0 | 0 |
| P2 | reveal | 9 | no | 800 | 0 | 7 |
| P2 | vote | 4 | **yes** (577px) | 1215 | 0 | 2 |
| P2 | voteResult | 3 | no | 800 | 0 | 0 |
| P2 | matchEnd | 2 | no | 800 | 0 | 1 |
| P2 | sessionEnd | 2 | no | 800 | 0 | 0 |

Checks where the page was wider or taller than the 380x800 viewport (scrollWidth x scrollHeight, ms after the screen appeared):

| ctx | phase | when / size |
| --- | --- | --- |
| host | lobby | lobby +905.4ms: 380x886 |
| host | lobby | lobby +2021.4ms: 380x965 |
| host | matchEnd | matchEnd +823.5ms: 380x875 |
| host | matchEnd | matchEnd +906ms: 380x875 |
| P2 | vote | vote:Q2 +139.6ms: 490x1032 |
| P2 | vote | vote:Q2 +1902.2ms: 577x1215 |

Tap targets under 44px (host, all phases, smallest seen):

| element | w x h | text | phases |
| --- | --- | --- | --- |
| `button.av-pick[data-action=pickAvatar]` | 34.3 x 43 | 🎒 | home, P2:home |
| `button.av-pick.sel[data-action=pickAvatar]` | 34.3 x 43 | 🧮 | home, P2:home |
| `summary` | 316 x 30 | 📖 How to play | lobby, P2:lobby |
| `input` | 90 x 40 |  | lobby |
| `button.bot-x[data-action=removeBot]` | 30 x 30 | ✕ | lobby |

Ellipsized (truncated) text:

| element | full text | needs/has px | phases |
| --- | --- | --- | --- |
| `span.pick` | Quentin Tarantino | 114/113 | reveal |
| `span.nm` | Class Clown Cal | 109/89 | reveal, matchEnd |
| `span.nm` | 📚 Class Clown Cal | 121/104 | reveal |
| `span.nm` | Class Clown Cal 🪑 | 133/89 | reveal |
| `span.nm` | 📚 Class Clown Cal 🪑 | 143/104 | reveal |
| `span.nm` | Sleepy Sam 🪑 | 104/89 | reveal |
| `span.nm` | 🎒 Sleepy Sam 🪑 | 118/104 | reveal |
| `button.vote-cell[data-action=vote]` | 📚 Class Clown Cal | 168/167 | vote |
| `button.vote-cell.picked[data-action=vote]` | 📚 Class Clown Cal | 168/167 | vote |

Above/below the 800px fold (host; page y-coordinates):

| phase | element | count | top px | bottom px | instances extending below fold |
| --- | --- | --- | --- | --- | --- |
| reveal | `[data-action=accuse]` | 1 | 548.5 | 636 | 0/10 |
| reveal | `[data-action=advance]` | 1 | 615.5 | 704 | 0/10 |
| reveal | `.board` | 1 | 360.5 | 528 | 0/10 |
| reveal | `.reveal-row` | 4 | 156.5 | 340 | 0/10 |
| vote | `.vote-grid` | 1 | 233 | 363 | 0/4 |
| vote | `.vote-cell` | 4 | 233 | 363 | 0/4 |
| lobby | `[data-action=start]` | 1 | 753.9 | 948.9 | 2/2 |
| matchEnd | `[data-action=advance]` | 1 | 741 | 795 | 0/2 |
| matchEnd | `[data-action=endSession]` | 1 | 805 | 859 | 2/2 |
| question | `.opt` | 4 | 202.4 | 474.4 | 0/9 |

## Role-screen tell

| ctx | .role-extra text | chars | state | box | changed while on screen |
| --- | --- | --- | --- | --- | --- |
| host | "It's you. Play it cool. 😎" | 26 | TEXT | 352 x 36.8 @ y478.6 | no |
| Player2 | "" | 0 | empty | 352 x 36.8 @ y478.6 | no |

The cheater's `.role-extra` holds 26 visible characters ("It's you. Play it cool. 😎") in accent yellow while the innocent's is an empty 36.8px gap. Boxes are pixel-identical in size/position, so the footprint rule holds, but anyone glancing at a neighbour's phone (or a streamed screen) reads the role instantly: blank line = innocent, yellow text = cheater.

### Parity probe (human cheater, same instant on both phones)

Extra rooms dealt until a human held the cheater role (OpenTDB blocked in probe rooms): #1 → host.

|  | cheater (host) | innocent |
| --- | --- | --- |
| .role-extra text | "It's you. Play it cool. 😎" | "" |
| visible chars | 26 | 0 |
| box | 352 x 36.8 @ 14,478.6 | 352 x 36.8 @ 14,478.6 |
| text changed while on screen | no | no |

Role screen pixel diff (`31-probe-role-diff.png`): **5200 px differ** (max channel delta > 16), bounding box 214.5 x 21 CSS px at 82,486.5; inside `.role-extra`: 5200, elsewhere: 0.

Question screen (`32-probe-cheater-question.png` vs `33-probe-innocent-question.png`, diff `34-probe-question-diff.png`): 6892 px differ. DOM identical apart from the `cheat-mark` class (clock-driven countdown text/ring offsets normalised): yes.

| region | differing px |
| --- | --- |
| .opt[0] | 0 |
| .opt[1] | 0 |
| .opt[2] | 0 |
| .opt[3] (cheat-mark) | 6843 |
| .qhead (timer + Q#) | 49 |
| .qtext | 0 |
| outside listed regions | 0 |

Geometry/style differences between the two phones' option buttons:

| option | cheat-mark | property | cheater | innocent |
| --- | --- | --- | --- | --- |
| 3 | yes | rect | {"x":14,"y":412.44,"w":352,"h":62} | {"x":14,"y":412.44,"w":352,"h":60} |
| 3 | yes | letterRect | {"x":31,"y":429.44,"w":12.69,"h":28} | {"x":30,"y":428.44,"w":12.69,"h":28} |
| 3 | yes | textRect | {"x":53.69,"y":432.94,"w":66.88,"h":21} | {"x":52.69,"y":431.94,"w":66.88,"h":21} |
| 3 | yes | borderWidth | 3px | 2px |
| 3 | yes | borderColor | rgb(53, 84, 63) | rgb(44, 74, 57) |
| 3 | yes | afterContent | "" | none |
| 3 | yes | afterBg | rgba(244, 241, 232, 0.28) | rgba(0, 0, 0, 0) |

## Cross-client sync (host vs Player2, same machine clock)

| phase | n | DOM mean |Δ| ms | DOM max |Δ| ms | first-frame mean |Δ| ms | first-frame max |Δ| ms | mean signed (P2-host) |
| --- | --- | --- | --- | --- | --- | --- |
| role | 1 | 0.2 | 0.2 | 10.9 | 10.9 | -0.2 |
| question | 7 | 0.3 | 0.7 | 2.7 | 6.6 | -0.3 |
| reveal | 8 | 2.6 | 5.4 | 3.1 | 9 | 2.6 |
| vote | 2 | 0.4 | 0.5 | 0.3 | 0.3 | 0.4 |
| voteResult | 2 | 4.4 | 5 | 3.6 | 4.1 | 4.4 |
| matchEnd | 1 | 2.4 | 2.4 | 0.6 | 0.6 | 2.4 |
| sessionEnd | 1 | 0.4 | 0.4 | 0.2 | 0.2 | 0.4 |

All transitions: n=22, DOM mean |Δ| 1.6 ms, p95 5 ms, max 5.4 ms (22/22 within 150 ms); first-frame mean |Δ| 2.9 ms, max 10.9 ms. positive = Player2 later than host (host renders via local loopback; Player2 via relay socket).

Note: the current build has no beat timeline at all. Each client renders the whole reveal the instant its state packet arrives, so this is "packet arrival" skew on localhost only; on real phones over Wi-Fi/LTE the relay hop adds tens to hundreds of ms per client.

## Match pacing (host)

Role → match end: 117.7 s. Time on screen: question 54.5 s, reveal 47.5 s, vote 7.9 s, voteResult 4.8 s.

| screen | durations (s) |
| --- | --- |
| question | 9.7, 8.9, 6.6, 9.8, 8.3, 7.3, 3.8 |
| reveal | Q1#1=9.2, Q2#1=2, Q2#2=1.2, Q3#1=9.2, Q4#1=6.1, Q4#2=1.3, Q5#1=9.3, Q6#1=9.2 |
| vote | 5.1, 2.9 |
| voteResult | 2.7, 2.1 |

Reveal dwell is set by the 8 s `revealMinMs` gate plus the host's tap (this script taps 1 s after it enables). Nothing on the reveal moves after its first frame.

## Screenshots

| file | context | screen |
| --- | --- | --- |
| `01-host-home.png` | host | home |
| `02-player2-home-deeplink.png` | player2 | home-deeplink |
| `03-host-lobby.png` | host | lobby |
| `04-host-lobby-full.png` | host | lobby-full (full page) |
| `05-player2-lobby.png` | player2 | lobby |
| `06-player2-role.png` | player2 | role |
| `07-host-role.png` | host | role |
| `08-host-question.png` | host | question |
| `09-player2-question.png` | player2 | question |
| `10-host-question-answered.png` | host | question-answered |
| `11-player2-question-answered.png` | player2 | question-answered |
| `12-host-reveal.png` | host | reveal |
| `13-player2-reveal.png` | player2 | reveal |
| `14-player2-reveal-full.png` | player2 | reveal-full (full page) |
| `15-host-reveal-full.png` | host | reveal-full (full page) |
| `16-host-reveal-accuse-confirm.png` | host | reveal-accuse-confirm |
| `17-player2-vote.png` | player2 | vote |
| `18-host-vote.png` | host | vote |
| `19-player2-vote-voted.png` | player2 | vote-voted |
| `20-host-vote-voted.png` | host | vote-voted |
| `21-host-voteResult.png` | host | voteResult |
| `22-player2-voteResult.png` | player2 | voteResult |
| `23-host-matchEnd.png` | host | matchEnd |
| `24-player2-matchEnd.png` | player2 | matchEnd |
| `25-host-matchEnd-full.png` | host | matchEnd-full (full page) |
| `26-player2-matchEnd-full.png` | player2 | matchEnd-full (full page) |
| `27-player2-sessionEnd.png` | player2 | sessionEnd |
| `28-host-sessionEnd.png` | host | sessionEnd |
| `29-probe-cheater-role.png` | probe | cheater-role |
| `30-probe-innocent-role.png` | probe | innocent-role |
| `31-probe-role-diff.png` | probe | role-diff |
| `32-probe-cheater-question.png` | probe | cheater-question |
| `33-probe-innocent-question.png` | probe | innocent-question |
| `34-probe-question-diff.png` | probe | question-diff |

Video: `capture/current/video/host.avi` (host context; CDP screencast -> MJPEG AVI (Playwright ffmpeg not installed); 380x800, 10 fps, 133.6 s, 1173 captured frames).

## Most important UX/animation problems (from the screenshots + numbers above)

1. **The reveal shows up all at once and then stays still.** The correct answer, every pick, ✓/✗, the times and the updated grade book all land in one frame (`12-host-reveal.png`). The reveal has no CSS animations (the only one is the accuse-confirm `shake`) and no transitions anywhere in the match. Nothing builds up, and the 8 s `revealMinMs` gate is dead air: the host's "Next question" sits there as a 45%-opacity dashed box until it quietly enables.
2. **The first reveal of every match stutters.** At 4x throttle, the first `reveal:Q1` render is a 106–111 ms long task on both phones: first-time style, layout and emoji rasterisation of the reveal DOM. Later reveals cost about 8 ms. The first entries of lobby (71–145 ms) and match end (58 ms) show the same pattern.
3. **Every packet rebuilds the whole screen.** `render()` replaces `#app` on every `state` *and* every `secret` message. That is 6–7 full rebuilds per question per phone, 2–4 per reveal and 5–6 per vote (89 per phone this match). Three visible effects:
   - The accused banner's `slam` replays each time a vote arrives (4 times in 2.4 s during `vote:Q2`).
   - The grade-book `.fill` width transition never runs.
   - The `slam`'s `scale(2.2)` briefly makes the page scroll sideways (577x1215 px measured mid-replay). `17-player2-vote.png` caught the banner overflowing both edges.
   Any animation added on top of this renderer would restart on every packet.
4. **The evidence is hard to read, so it's hard to accuse from.**
   - Reveal rows are in join order, but the grade book directly below is sorted by score: the same four people appear in two different orders on one screen.
   - Nothing marks the fastest answer or "only one person got it right".
   - At 380 px, picks and names are cut off with "…" ("Quentin Taranti…", "Class Clo…").
   - The correct answer is a single green text line. The `.opt.reveal-correct` / `.reveal-wrong-pick` styles exist but nothing uses them.
   - The vote screen (`17-player2-vote.png`) shows only names and a countdown, with no picks, times or scores, so accusers argue from memory.
5. **The grade book doesn't show the stakes.** The bar scale is `max(threshold, scores)`, so the graduation line is pinned to the right edge and early scores are 7%-wide stubs. After a wrong detention, the threshold drop is only text ("−200! Cheater now graduates at 1200!"); the line on the grade book never visibly moves. Spec 07's "-200 flying off the threshold" was never built.
6. **The cheater-only screens give the cheater away** (parity probe, `29`–`34-probe-*`):
   - **Role screen:** the cheater gets a yellow line, an innocent gets a blank gap (5,200 differing px, all inside `.role-extra`). When the cheater is a remote player, the line also pops in after the screen appears, because the secret arrives in a separate packet (33 ms and 43 ms in two earlier runs of this script where Player2 was dealt the cheater; this run's cheaters were host-side, so no delay).
   - **Cheat-mark changes the layout:** the marked option is 2 px taller (3 px vs 2 px computed border at this DPR), its label shifts 1 px, and in a run where the mark was on C, option D moved down 2 px.
   - **The pick highlight disappears for the cheater:** `.opt.cheat-mark` comes later in `style.css` with the same specificity as `.opt.picked`, so it overrides the yellow "your pick" border. When the cheater taps the marked answer, their answered screen has no yellow outline, while every innocent's does. Compare `10-host-question-answered.png` (cheater) with `11-player2-question-answered.png`.
7. **When the cheater graduates, the room never sees the answer that did it.** The threshold check in `endQuestion()` jumps straight from the question to the match end (`question:Q7` → `matchEnd` this run). The biggest "how did you know that?!" moment is never shown.
8. **The top of the screen collides.** The fixed 🎓 session tab covers the "offline questions" chip on the reveal (cut to "offline que" in `16-host-reveal-accuse-confirm.png`) and touches the timer ring on the question screen. The reveal header ("Q1/10 · 🎬 FILM STUDIES · GRADED") wraps to two lines.
9. **The accuse button jumps on confirm.** Its label becomes "BURN YOUR ONLY ACCUSATION?" on two lines, growing the button by about 30 px and pushing "Next question" down, right under the thumb that is about to tap again.
10. **The timer ring steps instead of moving smoothly.** A 150 ms `setInterval` writes `stroke-dashoffset`, which is paint-bound rather than transform/opacity, so the ring moves in visible steps. Its "under 5 s" colour change does nothing, because `--accent` and `--bad` are both `#ff6b6b`.
11. **Layout at 380x800:**
    - The lobby "Start class" button (y 754–949 with 4 players) and the match-end "End the school day" button (y 805–859) are below the fold.
    - Tap targets under 44 px: remove-bot ✕ (30x30), "How to play" summary (30 px tall), settings inputs (40 px), avatar picks (34x43).
    - The bottom 35–45% of the question, vote, vote-result and session-end screens is empty, while the reveal crams everything into the top 80%.
12. **There is no shared timeline.** On localhost, the two phones change screen within about 5 ms (DOM) and 11 ms (first frame), but only because each renders the moment its packet arrives. Over real Wi-Fi/LTE, each phone's reveal will start at its own network latency.

Measurement note: headless Edge on this machine runs rAF at about 144 Hz (6.9 ms vsync). With no animation work, the "mean fps" figures just show an idle main thread at vsync. The meaningful baseline numbers are the screen-entry long frames and long tasks, plus the render/animation-restart counts. The reveal currently has nothing to animate, so its smoothness cannot be measured yet.

---
Files (all paths absolute):
- Script: C:\Users\km099\Desktop\How Did You Know That\tools\capture-current.mjs
  - Full run: `node tools/capture-current.mjs`
  - Rebuild `REPORT.md` from `report.json`: `node tools/capture-current.mjs --report-only`
- Report: C:\Users\km099\Desktop\How Did You Know That\capture\current\REPORT.md
- Raw data: C:\Users\km099\Desktop\How Did You Know That\capture\current\report.json
- Observations section (merged into `REPORT.md`): C:\Users\km099\Desktop\How Did You Know That\capture\current\observations.md
- Screenshots: C:\Users\km099\Desktop\How Did You Know That\capture\current\01-…34-*.png
- Video: C:\Users\km099\Desktop\How Did You Know That\capture\current\video\host.avi
  - Playwright's recordVideo needs its ffmpeg download, which isn't installed, so I didn't download it. The script records a CDP screencast and writes it as an MJPEG AVI instead.
  - I checked the file's structure (1336 index entries, all valid JPEG frames) but did not play it.