# 05 — Networking

## Architecture: host-authority relay (reused pattern)
- **Host = a player** whose browser holds the single authoritative game state.
- **Server = dumb relay** (Node + Socket.IO): rooms, message forwarding, nothing else. No game logic server-side.
- Clients send **intents** to the host (via relay); host validates, mutates state, broadcasts **state updates**.
- Known limitation: host can inspect full state incl. cheater identity (00). Accepted.

## Stack
TypeScript across the board. Socket.IO for transport. Same skeleton as the strategy game project — reuse the room/relay layer directly if practical.

## Rooms & joining
- Host creates a lobby → server issues a 5-char room code → shareable link `https://<app>/#/join/CODE`.
- Joining: enter display name, done. No accounts (00).
- Room dies when host disconnects (00 known limitation). Non-host disconnects: seat is held; rejoin via the same link + same name restores the seat and current state.

## Message protocol (intent → host, state → all)
**Client → host intents**
- `join {name}` · `answer {questionIdx, optionIdx, clientElapsedMs}` · `burnToken {targetPlayerId}` (v0.23: the accused) · `castVote {targetPlayerId}` · `hostOnly: startMatch / advanceReveal / endSession / updateSettings`

**Host → clients state events**
- `lobbyState` (players, settings)
- `roleAssign` — **private per-socket message**; cheater's payload includes `isCheater: true`; everyone else `false`. Identical timing/size padding so traffic analysis by players is unhelpful (best-effort).
- `questionStart {idx, text, options[], tier, deadline}` — cheater's copy additionally carries `correctIdx` **only in the private variant** (never broadcast).
- `reveal {correctIdx, perPlayer: {pick, correct, timeMs}[], scores, threshold}`
- `voteStart {accuserId, accusedId, opensAt, deadline}` (v0.23: ballots open at `opensAt`, after the accused's floor; `accusedId` and `opensAt` are absent in v0.22 saves and tapes, which render the old stage) · `voteResult {accusedId, tallies, banishedId?, wasCheater?, newThreshold?}`
- `matchEnd {reason, cheaterId, scores, sessionBoard}` · `sessionEnd {board}`

## Timing & authority notes
- Answer times: measured client-side (`clientElapsedMs`), reported with the answer, displayed as-is. Spoofable — accepted for a trust-your-friends game; the host clamps to `[0, timerMs]`.
- All deadlines are host-issued timestamps; clients render countdowns locally.
- Host advances phases; a stalled non-host player never blocks the game (timers resolve everything).

## Failure handling (v1 minimum)
- Relay reconnect: Socket.IO auto-reconnect; on reconnect, client requests `fullState`.
- Duplicate names in a room: reject at join with a friendly error.
