# 06 — Content Pipeline (Open Trivia DB)

## Source
Open Trivia DB (opentdb.com) — free, no key required, native 4-option multiple choice, difficulty tiers `easy | medium | hard` that map 1:1 onto the match ramp (01).

## Who fetches
The **host client** fetches all questions (host-authority, 05). Players never contact OpenTDB.

## Fetch strategy
- At match start, fetch the full match in tier batches: 3 easy + 4 medium + 3 hard.
- API shape: `https://opentdb.com/api.php?amount=N&difficulty=easy&type=multiple[&token=...]`
- **Session token**: request one per session (`api_token.php?command=request`) and pass it on every fetch — prevents repeated questions across matches in the same session. On token-exhausted response code, reset the token.
- **Rate limit**: OpenTDB allows roughly one request per ~5s per IP. Space the three tier requests ≥5s apart, or prefetch the *next* match's questions in the background during the current match (preferred — zero perceived wait).

## Sanitization (mandatory)
- Responses are HTML-encoded — decode entities (`&quot;`, `&#039;`, etc.) in questions and answers before display.
- Shuffle the 4 options per question (OpenTDB returns correct + incorrect separately); record `correctIdx` post-shuffle. **Same shuffled order for every player** (01).

## Category handling
- v1: no category filter (any category) — maximum variety, zero UI. Lobby setting for category selection is a listed v2 candidate, not built now.

## Fallback pack
- Bundle a local JSON pack (~60 questions: 20/20/20 per tier) in the client build.
- Used when OpenTDB is unreachable, errors, or can't fill a tier batch. Host UI shows a small "offline questions" badge so nobody wonders why questions feel familiar.
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
