# 03 — Accusations & Voting

## Tokens
- Each player holds **exactly one accusation token per match**. Not replenished.
- Burning a token is public and attributed: "KRISTIAN HAS ACCUSED." It triggers a vote immediately.
- Tokens can only be burned **during a REVEAL phase** (01). Never mid-question.
- Banished players (see below) cannot burn their token even if unused.
- Only one accusation can be processed at a time; if two players tap near-simultaneously, host order decides — first one triggers the vote, the second token is **not** consumed.

## Vote flow
1. Trigger: any eligible player burns their token during reveal.
2. Casting: **everyone with voting rights votes for any player** (including themselves, including the accuser — no restrictions). Cheater votes normally.
3. Window: 20s. Not voting = abstain.
4. Votes are hidden while casting, then all revealed simultaneously with voter attribution (who voted for whom — more social ammunition).
5. Resolution: plurality is banished.

## Tie rule
Tie for most votes = **nobody is banished**, the burned token stays burned. A failed coordinated accusation wastes the shot. No threshold drop on a tie (nobody was wrongly banished).

## Outcomes
### Banished player is the CHEATER
- Match ends immediately: innocents win. Full reveal. Session points per 04.

### Banished player is INNOCENT
- They **keep answering questions and scoring**, but permanently lose voting rights and accusation rights for the rest of the match.
- They remain eligible to win the match on points at Q10 (04) — a redemption arc.
- The cheater's threshold drops by 200, announced loudly (02).
- It is a **strike** (v0.4): at the strike limit (default 2) the cheater graduates on the spot (02).
- Otherwise the match continues.

## Edge cases
- If all remaining tokens are burned, no further votes are possible; the match resolves via threshold or Q10.
- If banishments ever leave **fewer than 2 players with voting rights**, remaining votes are impossible anyway (a single voter's plurality is trivially decisive — allowed; it's their funeral if wrong).
- Abstain-only vote (nobody casts): treated as a tie — no banishment, token stays burned.
