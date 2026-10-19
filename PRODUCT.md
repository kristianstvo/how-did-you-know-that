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
| v0.5.0 | Suspicion pointers: point at a suspect for free, before spending your accusation | planned |
| v0.6.0 | Game-show sound: synthesized, synced to the beats, one mute | planned |
| v0.7.0 | Report-card awards: superlatives per period and per day | planned |
| v0.8.0 | Lobby presets instead of raw numbers; host tools | planned |
| v0.9.0 | First-timer onboarding; a better detention experience | planned |

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
