# Phone reveal constraints, late 2026

Tags: **[M]** measured or empirical data · **[C]** published convention, spec or vendor statement · **[I]** my inference.

## 1. Motion systems
- **M3 durations [C]:** short1–4 are 50, 100, 150 and 200ms. medium1–4 are 250–400ms in 50ms steps. long1–4 are 450–600ms. extralong1–4 are 700, 800, 900 and 1000ms. https://api.flutter.dev/flutter/material/Durations-class.html
- **M3 easings [C]:**
  - emphasizedDecelerate `cubic-bezier(0.05,0.7,0.1,1)`
  - emphasizedAccelerate `(0.3,0,0.8,0.15)`
  - standard `(0.2,0,0,1)`
  - standardDecelerate `(0,0,0,1)`
  - standardAccelerate `(0.3,0,1,1)`
  - legacy `(0.4,0,0.2,1)`
  - Source: https://raw.githubusercontent.com/flutter/flutter/master/packages/flutter/lib/src/material/motion.dart
- **M3 springs, from the androidx source [C]:**
  - Standard scheme, spatial: damping 0.9, stiffness 1400 / 700 / 300 (fast / default / slow). https://raw.githubusercontent.com/androidx/androidx/androidx-main/compose/material3/material3/src/commonMain/kotlin/androidx/compose/material3/tokens/StandardMotionTokens.kt
  - Expressive scheme, spatial: fast 0.6/800, default 0.8/380, slow 0.8/200. https://raw.githubusercontent.com/androidx/androidx/androidx-main/compose/material3/material3/src/commonMain/kotlin/androidx/compose/material3/tokens/ExpressiveMotionTokens.kt
  - Effects (opacity and color), both schemes: damping 1.0, stiffness 3800 / 1600 / 800.
  - Spatial specs are meant for bounds changes and may overshoot. https://developer.android.com/reference/kotlin/androidx/compose/material3/MotionScheme
- **Apple HIG [C]** (last updated 9 Sep 2025): use motion on purpose and make it optional. Never let motion be the only carrier of information; back it with haptics or audio. Keep feedback brief and precise, and let people cancel animations they see repeatedly. For games, aim for a steady 30–60fps. The page gives no millisecond values. https://developer.apple.com/tutorials/data/design/human-interface-guidelines/motion.json
- **IBM Carbon [C]:** productive motion is for task UI; expressive motion is for rare, significant moments.
  - Productive curves: standard `(0.2,0,0.38,0.9)`, entrance `(0,0,0.38,0.9)`, exit `(0.2,0,1,0.9)`.
  - Expressive curves: standard `(0.4,0.14,0.3,1)`, entrance `(0,0,0.3,1)`, exit `(0.4,0.14,1,1)`.
  - Durations: 70, 110, 150, 240, 400 and 700ms. Duration grows non-linearly with travel distance and scale change.
  - https://carbondesignsystem.com/elements/motion/overview/
- **Not found:** a formula converting pixels of travel into milliseconds for mobile. Carbon's scale is the most concrete guidance available.

## 2. Perception thresholds
- **Response limits [C, built on empirical work]:** 0.1s feels instantaneous, 1s keeps the flow of thought, 10s is the limit of attention (Miller 1968; Card et al. 1991). https://www.nngroup.com/articles/response-times-3-important-limits/
- **Perceptual cycle [M, aggregate]:** the Model Human Processor puts it at about 100ms, with a reported range of 50–200ms. https://en.wikipedia.org/wiki/Human_processor_model
- **Audio vs video, ITU-R BT.1359 [M, newsreader clips]:** detectable at +45ms (audio early) or −125ms (audio late). Acceptable up to about +90 / −185ms. ATSC is stricter [C]: audio may lead by at most 15ms and lag by at most 45ms. https://www.tvtechnology.com/opinions/av-synchronization-how-bad-is-bad
- **Visual vs visual [M]:** two separated flashes 30–50ms apart were seen as not simultaneous, even though viewers could not tell which came first. https://link.springer.com/doi/10.1007/BF00356854
- **The same sound from several devices [M]:** it fuses into one sound below about 40ms for speech or music, and below 1–5ms for clicks. Longer gaps are heard as an echo. https://en.wikipedia.org/wiki/Precedence_effect
- **Watching together [M, n=36]:** people on voice chat noticed desync sooner than people on text chat. I could not get the exact second thresholds from the full paper. https://ir.cwi.nl/pub/17852
- **Voice latency [C]:** ITU-T G.114 says mouth-to-ear delay under 150ms is essentially transparent. https://www.cs.columbia.edu/~andreaf/new/documents/other/T-REC-G.114-200305.pdf
- **Not found:** any study of how much visual drift people notice between several phones in one room.
  - [I] Remote players compare their screen against other people's voices, so the call latency sets the noticeable floor.
  - [I] Players in the same room need about 30–50ms to see beats as simultaneous.

## 3. Clock sync over WebSockets
- **Method [C]:** offset = server time minus the local midpoint of the round trip. Path asymmetry keeps the error below RTT/2, so keep the samples with the lowest RTT. https://www.nist.gov/node/1907461 · https://en.wikipedia.org/wiki/Cristian%27s_algorithm
- **Libraries:**
  - `timesync` takes 5 samples 1s apart, drops samples more than one standard deviation from the median, and resyncs hourly. The repository was archived on 16 Jul 2025. https://github.com/enmasseio/timesync
  - `clocksy` uses an IIR filter and claims convergence under 10ms. That claim is not benchmarked [C]. https://github.com/guigrpa/clocksy
- **Achieved accuracy [M, anecdotal]:**
  - A browser offset estimate reached ±8ms once the connection was kept alive. Before that fix, two windows disagreed by 190ms, because new connections inflated the RTT. https://alexsci.com/blog/how-time-gov-works
  - [C] Socket.IO starts every connection on HTTP long-polling and only then upgrades to WebSocket. https://socket.io/docs/v4/how-it-works/
- **Clock pitfalls:**
  - `performance.now()` is monotonic, but `timeOrigin` can differ from `Date.now()`. Resolution is coarsened to at least 100µs (5µs when cross-origin isolated). https://w3c.github.io/hr-time/
  - `Date.now()` follows the wall clock and can jump.
  - `performance.now()` only reliably keeps ticking through sleep on Windows [M]. https://bugs.webkit.org/show_bug.cgi?id=225610
- **Throttling and suspension:**
  - Hidden Chrome tabs run timers once per second. After 5 minutes hidden, a timer chain of 5 or more, and 30s of silence, they drop to once per minute [C]. https://developer.chrome.com/blog/timer-throttling-in-chrome-88
  - iOS Safari drops sockets when it goes to the background, and after long idle periods `onclose` may never fire [M, field reports]. https://developer.apple.com/forums/thread/696310

## 4. Browser support, late 2026
- **Same-document View Transitions [C]:** Chrome and Edge 111, Safari 18.0 (macOS and iOS), Firefox 144 (14 Oct 2025), Samsung Internet 23. About 92.9% of global usage. https://caniuse.com/view-transitions
  - Transition types: Chrome 125, Safari 18, Firefox 144.
  - Only one transition runs at a time; starting a new one jumps the running one to its end.
  - The page is frozen while the update callback runs.
  - Two elements with the same `view-transition-name` cause the transition to be skipped.
  - https://developer.chrome.com/docs/web-platform/view-transitions/same-document
  - The old state is a static snapshot and the new state is live. A hidden page skips the transition. https://developer.mozilla.org/en-US/docs/Web/API/View_Transition_API/Using
- **Vibration [C]:**
  - Only Chromium browsers support it (Chrome Android, Samsung). No Safari version through 27.x does. Firefox removed it in version 129, and WebKit opposes the spec. https://caniuse.com/vibration · https://www.w3.org/TR/vibration/
  - It needs sticky user activation. https://developer.mozilla.org/en-US/docs/Web/API/Navigator/vibrate
  - iOS workaround: toggling an `<input type=checkbox switch>` produces a system haptic. Since Jan 2025 this needs user activation. https://bugs.webkit.org/show_bug.cgi?id=285120
  - One unverified source says iOS 26.5 closed the programmatic version of this trick. https://rapidtoolset.com/en/tool/ios-haptics-tester
- **`prefers-reduced-motion` [C]:** Chrome 74, Safari 10.1, iOS 10.3, Firefox 63. About 97.2% of global usage. https://caniuse.com/prefers-reduced-motion
- **WCAG 2.3.3 (AAA) [C]:** people must be able to turn off motion triggered by an interaction, unless the motion is essential. Sufficient techniques are C39 (CSS) and SCR40 (JS). https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html
- **Web Animations API [C]:** full support in Chrome 84, Safari 13.1 / iOS 13.4, Firefox 75. About 97.2% of global usage. https://caniuse.com/web-animation

## 5. Mobile animation performance
- **Compositor-only properties [C]:** only `transform` and `opacity` skip layout and paint, and the element needs its own layer. Every layer costs memory and a GPU upload, so promote only what animates. https://web.dev/articles/stick-to-compositor-only-properties-and-manage-layer-count
- **`will-change` [C]:** use it as a last resort. Set it just before the change and remove it afterwards; it also creates a stacking context. https://developer.mozilla.org/en-US/docs/Web/CSS/will-change
- **Frame budgets [C]:** 16ms at 60Hz, of which about 10ms is available for app work. 11ms at 90Hz, 8ms at 120Hz. https://web.dev/articles/rail · https://developer.android.com/topic/performance/vitals/render
- **iOS Low Power Mode [M]:** caps `requestAnimationFrame` at 30fps, and WebKit says this is intentional. https://bugs.webkit.org/show_bug.cgi?id=215745
- **CPU throttling [C]:**
  - At 4x, DevTools suspends the main thread about 75% of the time and leaves the GPU process alone.
  - Calibrated low-tier and mid-tier mobile presets exist since Chrome 134. The post's example mid-tier rate was 3.7x.
  - https://developer.chrome.com/blog/devtools-grounded-real-world
  - The factor is a slowdown multiple (1 = none, 2 = half speed). https://pptr.dev/api/puppeteer.page.emulatecputhrottling
  - I could not render the CDP docs page for `Emulation.setCPUThrottlingRate`.
- **Measuring frames:**
  - Long Animation Frames (Chrome 123+) reports frames over 50ms, with a buffer of 200 entries. Firefox and Safari don't support it. https://developer.chrome.com/docs/web-platform/long-animation-frames
  - Trace `PipelineReporter` events record whether each frame was presented or dropped. https://pigweed.googlesource.com/third_party/android/platform/external/perfetto/+/2d5e2a6b4f7ee022cefaf94118264c175a9acda3

## 6. DOM morphing
- **morphdom 2.7.8 [C]:** the latest fix is to body morphing; I found no release date. It matches siblings by `id`, and `getNodeKey` can override that. Returning false from `onBeforeElUpdated` skips an element. https://github.com/patrick-steele-idem/morphdom · https://cdn.jsdelivr.net/npm/morphdom@2.7.8/CHANGELOG.md
- **idiomorph 0.8.0 [C]:** published 5 Sep 2026 (0.7.4 was 29 Sep 2025). https://registry.npmjs.org/idiomorph
  - It matches on "id sets" that include descendant ids, so wrappers without ids still match, and it moves the minimum number of nodes.
  - `restoreFocus` is on by default; `ignoreActive` and `ignoreActiveValue` are available.
  - It is about 10% slower than morphdom on large morphs. https://github.com/bigskysoftware/idiomorph
  - htmx 4 builds this algorithm in. https://four.htmx.org/docs/morphing-swaps-guide
- **Not found:** neither README documents how morphing interacts with CSS animations.
  - [C] Re-applying the same class does not restart an animation. https://lists.w3.org/Archives/Public/public-css-bugzilla/2012Mar/0214.html
  - [M] A Turbo user only got transitions to work once the page was actually morphed. https://discuss.hotwired.dev/t/turbo-morphing-css-animation/5820

## Implications for our build [I]
1. **Tokens:** use Carbon productive curves for UI chrome and expressive curves plus M3 emphasizedDecelerate for reveal beats. Keep beats in the 150–400ms range, and keep each drumroll hold between 1s and 10s.
2. **Sync:** sync every client, host included, to the relay server's clock rather than to the host through the relay. Send about 8 pings over an upgraded WebSocket (or force `transports:['websocket']`) and keep the lowest-RTT samples. Schedule beats on `performance.now()`. Resync on `visibilitychange` and `pageshow`, and add heartbeats. A 150ms spread between clients looks easy to meet given ±8ms results.
3. **Audio:** if all phones play a sting, players in one room hear an echo unless the phones land within about 40ms. Default to visual beats only, or play audio on the host only.
4. **Haptics:** treat them as an enhancement only. They are reliable only on Android, on iOS they work only inside a tap, and they must never carry information on their own.
5. **Performance proof:** CPU throttling doesn't slow the GPU, so a throttled desktop run is optimistic. Measure dropped frames from traces as well as `requestAnimationFrame` intervals, and test one real mid-range Android. iOS Low Power Mode makes 55fps impossible, so beats have to read well at 30fps.
6. **View Transitions:** run one transition per screen change, never one per broadcast, and serialize them. Give each of the 10 avatars a unique name. Size changes animate the box's width and height (not compositor-only), so keep sizes constant.
7. **Morphing:** use idiomorph with stable per-player ids, and have `beforeAttributeUpdated` protect animation classes.
8. **Reduced motion:** swap movement for opacity but keep the beat timings identical, which also keeps cheater and innocent timelines in parity.