# 00 — Overview

**Working title:** Smartass (rename freely; nothing depends on it)

## What this is
A browser-based social deduction party game disguised as a quiz. All players answer the same 10 multiple-choice trivia questions. One player — the **cheater** — secretly sees the correct answers. The cheater tries to score their way to a public point threshold; everyone else tries to sniff them out and banish them.

## Real goal (from design interview)
Not a friends-only toy: **shareable beyond the original friend group.** Other groups grab a link, host a private lobby, and play on their phones. Fun must come from the rules, not from in-group familiarity.

## Success criteria
- A group of 4–8 strangers-to-the-dev can run a full session with zero explanation beyond one rules screen.
- Works well on phones (primary target) and desktop.
- The core emotional beat — "no way you knew that!" accusations — happens organically in playtests.

## Non-goals (v1)
- No accounts, no persistence beyond a session, no public matchmaking, no spectator mode, no chat (players use their own voice call).

## Player count
3–10. **4+ strongly recommended**; with 3 players voting is nearly a coin flip. Lobby shows a warning at 3.

## Known limitations (consciously accepted)
1. **Host can peek.** Host-authority architecture means any lobby host can inspect dev tools and see the cheater's identity and answers. Mitigation is purely social: hosts are trusted by their own group. (Expanded from previous projects, where the dev was always the host.)
2. **Host disconnect kills the session.** Consistent with the relay model; no host migration in v1.
   *Softened since (10-phone-play.md): a dropped connection gets a 90-second grace period and the host's phone reclaims the room; closing or reloading the host's page still ends the session.*
3. **Screen-share leakage.** The cheater's answer marker is deliberately subtle (see 07) but a careless screen-share can still reveal it.

## Glossary
- **Match** — one 10-question game with one cheater.
- **Session** — a series of matches with the same lobby; has its own leaderboard (04).
- **Reveal phase** — post-question screen showing everyone's picks, correctness, and answer times; the only window where accusations may be triggered.
- **Threshold** — public score the cheater must reach to instantly win a match.
- **Token** — each player's single per-match right to trigger a banishment vote.

## Spec map
01 match loop · 02 cheater system · 03 accusations & voting · 04 scoring & session · 05 networking · 06 content pipeline · 07 UI screens

## Build order (recommended)
1. Relay + match loop with **hardcoded fake questions** (01, 05)
2. Cheater system + threshold (02)
3. Accusations & voting (03)
4. Session scoring (04)
5. OpenTDB pipeline swap-in (06)
6. UI polish pass (07)
