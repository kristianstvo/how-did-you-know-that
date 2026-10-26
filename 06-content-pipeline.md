# 06 — Content Pipeline (Open Trivia DB)

## Source
Open Trivia DB (opentdb.com) — free, no key required, native 4-option multiple choice, difficulty tiers `easy | medium | hard` that map 1:1 onto the game's tiers (01).

## Who fetches
The **host client** fetches all questions (host-authority, 05). Players never contact OpenTDB.

## Fetch strategy
- v0.26: questions are drawn one at a time, at the tier the class earned (01). The host keeps a few OpenTDB questions of each tier ready in the background (3 medium, 2 hard, 1 easy) and draws from the curated local pack whenever none is ready. (Until v0.25: the full match at start, 3 easy + 4 medium + 3 hard.)
- v0.29: the curated pack comes first: a question the host's phone has never hosted, in a subject the period hasn't had. The ready OpenTDB questions are used only when the pack has none, before the pack repeats itself. OpenTDB leans American; the pack is written and fact-checked for an international, mostly European class.
- v0.26: the host's phone remembers the questions it has hosted (the last 800, on the phone only) and draws ones it hasn't first, so a group's second night doesn't repeat the first.
- API shape: `https://opentdb.com/api.php?amount=N&difficulty=easy&type=multiple[&token=...]`
- **Session token**: request one per session (`api_token.php?command=request`) and pass it on every fetch — prevents repeated questions across matches in the same session. On token-exhausted response code, reset the token.
- **Rate limit**: OpenTDB allows roughly one request per ~5s per IP. Space the three tier requests ≥5s apart, or prefetch the *next* match's questions in the background during the current match (preferred — zero perceived wait).

## Sanitization (mandatory)
- Responses are HTML-encoded — decode entities (`&quot;`, `&#039;`, etc.) in questions and answers before display.
- Shuffle the 4 options per question (OpenTDB returns correct + incorrect separately); record `correctIdx` post-shuffle. **Same shuffled order for every player** (01).

## Category handling
- v1: no category filter (any category) — maximum variety, zero UI. Lobby setting for category selection is a listed v2 candidate, not built now.

## The curated pack
- Bundled in the client build (`client/src/localPack.ts`), and since v0.29 the main source: 810 questions (196 easy, 365 medium, 249 hard) across the twelve school subjects, written for an international, mostly European class and fact-checked by a second, independent reviewer (v0.26, v0.29, v0.30).
- `sim/pack-check.ts` keeps it honest: every subject has at least 4 questions of every tier, nothing repeats, everything fits a phone (text ≤ 90 characters, options ≤ 32).
- Until v0.29 it was the fallback for when OpenTDB was unreachable or had nothing ready. A pack question is the normal case now, so there is no "offline questions" badge.
- Pack format identical to the internal question shape below — the game logic never knows which source fed it.

## Internal question shape (the only thing game logic sees)
```ts
interface Question {
  text: string;
  options: [string, string, string, string]; // pre-shuffled
  correctIdx: 0 | 1 | 2 | 3;
  tier: "easy" | "medium" | "hard";
  source: "opentdb" | "local";
}
```
This is the pluggable-provider seam (same pattern as the strategy game's quiz providers): OpenTDB and the local pack are two providers behind one interface; future providers (AI-generated, custom packs) slot in without touching game logic.
