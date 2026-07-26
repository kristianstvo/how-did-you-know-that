# 07 — UI Screens

## Platform rules
- **Mobile-first, portrait.** Every screen designed for ~380px width first; desktop is the adaptation, not the base.
- Tap targets ≥ 44px. One-thumb play throughout.
- Up to 10 players must fit on reveal/leaderboard screens — dense list layouts, not cards.

## Screens

### 1. Home / Join
- Create Lobby (becomes host) or Join via code. Deep link `/#/join/CODE` pre-fills the code; player only types a name.

### 2. Lobby
- Player list, room code + share button (native share sheet on mobile).
- Host-only: settings (timer, points, threshold, drop — 01/02), Start Match.
- Warning banner at 3 players ("voting is chaos with 3 — 4+ recommended").
- One collapsible **How to Play** panel: the whole rules explanation lives here and nowhere else (00 success criterion).

### 3. Role assign
- Identical look for all: "Roles assigned. Someone here is the cheater…" 3s, auto-advance. Cheater sees one extra line: "It's you. Play it cool." — same layout footprint.

### 4. Question
- Question text, 4 full-width option buttons, countdown ring.
- **Cheater variant:** correct option carries a subtle marker (slightly heavier border / faint corner dot — 02). Pixel-identical layout otherwise.
- After answering: options lock, "waiting for others" state with count.

### 5. Reveal (the main stage)
- Correct answer highlighted; per-player row: name · pick · ✓/✗ · time ("1.4s").
- Leaderboard strip with the **threshold line** and current value ("Cheater wins at 1400").
- **ACCUSE button** (token) — big, red, bottom-fixed. Disabled with tooltip once burned/banished. Confirmation tap required ("Burn your only token?").
- Host-only Next button after the 8s minimum.

### 6. Vote
- Full-screen takeover: "KRISTIAN HAS ACCUSED." Player grid, tap to vote, 20s countdown.
- Then simultaneous reveal of all votes with voter→target attribution.
- Result banner: banished innocent (threshold drop animation, "-200" flying off the threshold) or CHEATER CAUGHT → match end.

### 7. Match end
- Three variants by end condition (04): CHEATER CAUGHT / CHEATER WINS (sirens, instant takeover mid-reveal) / TOP SCORER WINS.
- Always: cheater identity reveal, final match scores, session points earned this match, Next Match (host) button.

### 8. Session leaderboard
- Standings across matches. Shown on match end and via a persistent small tab. Session End (host) → final podium screen.

## Visual tone
Loud party energy: big type, saturated colors, juicy animations on threshold drops and reveals. This is a screaming-at-your-phone game, not a pub quiz app. (Design pass uses the frontend-design skill at build time.)

## States to not forget
- Banished innocent: grey badge on their row everywhere; ACCUSE and vote disabled with explanatory tooltip; still answers questions normally.
- Disconnected player: dimmed row, "reconnecting…"; timers never wait for them (05).
- Offline questions badge when fallback pack active (06).
