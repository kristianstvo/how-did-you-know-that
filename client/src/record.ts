// Your report card (v0.12): this phone's own record across every day it has
// played — periods, wins, cheater turns, catches, superlatives. Kept in this
// phone's storage only; nothing is sent anywhere. Counted once per period
// from the public result, so it can never reveal anything secret.
import type { PublicState } from "../../shared/protocol";

const KEY = "hdykt-record";
const SEEN = "hdykt-record-seen"; // sessionStorage: periods already counted (reloads)

export interface PlayRecord {
  periods: number;
  wins: number;
  cheater: number; // periods played as the cheater
  cheaterWins: number; // …and won (graduated, struck the class out, or topped it)
  caught: number; // periods as an innocent where the class caught the cheater
  detentions: number; // sent to detention while innocent
  awards: Record<string, number>; // superlative title -> times earned
}

const empty = (): PlayRecord => ({ periods: 0, wins: 0, cheater: 0, cheaterWins: 0, caught: 0, detentions: 0, awards: {} });

export function loadRecord(): PlayRecord {
  try {
    return { ...empty(), ...(JSON.parse(localStorage.getItem(KEY) ?? "null") ?? {}) };
  } catch {
    return empty();
  }
}

/** Count a finished period for this phone (once per period). */
export function countPeriod(s: PublicState, selfId: string, periodKey: string): void {
  const end = s.match?.end;
  const me = s.players.find((p) => p.id === selfId);
  if (!end || !me) return; // in the hallway this period: nothing to count
  let seen: string[] = [];
  try {
    seen = JSON.parse(sessionStorage.getItem(SEEN) ?? "[]");
  } catch {
    /* storage blocked: count anyway */
  }
  if (seen.includes(periodKey)) return;
  const r = loadRecord();
  const cheater = end.cheaterId === selfId;
  const won = end.winnerIds.includes(selfId);
  r.periods++;
  if (won) r.wins++;
  if (cheater) {
    r.cheater++;
    if (won) r.cheaterWins++;
  } else {
    if (end.reason === "cheater_banished") r.caught++;
    if (me.banished) r.detentions++;
  }
  for (const a of end.awards ?? []) if (a.playerId === selfId) r.awards[a.title] = (r.awards[a.title] ?? 0) + 1;
  try {
    localStorage.setItem(KEY, JSON.stringify(r));
    sessionStorage.setItem(SEEN, JSON.stringify([...seen, periodKey].slice(-50)));
  } catch {
    /* storage blocked: this phone just won't remember */
  }
}
