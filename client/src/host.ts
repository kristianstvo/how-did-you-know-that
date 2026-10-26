// The TV host's cue sheet (v0.19): which line Amy says on which beat of the
// big screen. It reads only what every phone shows (public state and the
// shared-clock beats, the same inputs as the motion and the sound effects),
// so she can never give a secret away. Phones never run it.
import { matchEndTimeline, revealTimeline } from "../../shared/choreo";
import type { PublicState } from "../../shared/protocol";
import { serverNow } from "./clock";
import type { LineId } from "./hostLines";
import { dropQueued, hush, say, sayTimed, sayWhenHeard } from "./voice";

const LETTERS = ["a", "b", "c", "d"] as const;
/** Entrance lines only play on time: a screen that was already running when
 *  this TV caught up (a late join, a reconnect) goes by in silence. */
const FRESH_MS = 1500;
/** "And the cheater was..." ends this long before the unmask. */
const DRUM_GAP = 150;

let phase = "";
let seen = false; // a game screen has shown: the welcome is for a lobby only
let welcomed = false;
let nudges = 0; // how-to-accuse prompts said (first reveals only)
let hands = 0; // accusations seen
/** Evidence quips already said this period: each once, or they grate. The
 *  line alerts (near the line, cleared) carry news every time they fire. */
const quipped = new Set<string>();
let quipPeriod = -1;
let flip = false;
/** Alternate two takes of a call that comes back all night. */
const take = (a: LineId, b: LineId): LineId => ((flip = !flip) ? a : b);

let afterWelcome: (() => void) | null = null;
/** v0.20: what the big screen does once she has welcomed the room (main.ts
 *  plays the how-to-play tutorial), if it's still homeroom by then. */
export function setAfterWelcome(fn: () => void): void {
  afterWelcome = fn;
}

export function hostCue(s: PublicState | null, screenKey: string, added: string[], entered: boolean, settled: boolean): void {
  phase = screenKey === "session" ? "sessionEnd" : screenKey.split("-")[0];
  if (!s) return;
  if (!seen) {
    seen = true;
    if (phase !== "lobby") welcomed = true; // joined mid-game: no "good evening"
  }
  if (settled) {
    // The teacher skipped the show: whatever she was saying about it is stale.
    if (phase === "reveal" && !entered) hush();
    return;
  }
  if (entered) dropQueued(); // a new screen: no follow-ups about the last one
  const m = s.match;
  const fresh = serverNow() - s.phaseStartedAt < FRESH_MS;
  const has = (b: string) => added.includes(b);
  switch (phase) {
    case "lobby":
      if (!welcomed) {
        welcomed = true;
        sayWhenHeard(
          "welcome",
          () => phase === "lobby",
          (endsAt) =>
            setTimeout(() => {
              if (phase === "lobby") afterWelcome?.();
            }, Math.max(0, endsAt - serverNow()) + 900),
        );
      }
      break;
    case "role":
      if (has("bell") && fresh) say(s.matchNumber <= 1 ? "period_first" : "period_next");
      break;
    case "question": {
      const q = m?.question;
      if (!m || !q) break;
      // She finishes her sentence (the bell's speech runs into the first
      // question; a quick teacher can start the next one mid-verdict), then
      // calls the number if it's still news, or lets the screen show it.
      // v0.26: when the class moved the difficulty, that's the news (the
      // number is on screen). The final question keeps its own call.
      const call: LineId = q.shift && m.questionIdx < m.questionCount - 1 ? (q.shift === "up" ? "harder" : "easier") : (`q${m.questionIdx + 1}` as LineId);
      if (entered && fresh) say(call, { mode: "next", wait: 3000 });
      if (has("u5") && s.players.some((p) => p.connected && !p.answeredCurrent)) say(take("five_a", "five_b"), { mode: "aside" });
      // Pencils down on hard questions only: their reveals are slow enough to
      // fit it before the answer call. A quick reveal needs her for the letter.
      if (has("pencils") && q.tier === "hard") say(take("pencils_a", "pencils_b"), { mode: "aside" });
      break;
    }
    case "reveal": {
      const r = m?.reveal;
      if (!m || !r) break;
      if (entered) {
        // The letter lands as the answer lights up: the long call when the
        // show leaves it ~2s of runway, the short one otherwise.
        const letter = LETTERS[r.correctIdx];
        const answerAt = r.startedAt + revealTimeline(r.stakes, r.rows.length, !!r.callout).beats.answer;
        if (letter) sayTimed([`answer_${letter}`, `quick_${letter}`], (c) => answerAt - c.hit);
      }
      if (s.matchNumber !== quipPeriod) {
        quipPeriod = s.matchNumber;
        quipped.clear();
      }
      const kind = r.callout?.kind;
      if (has("evidence") && kind && kind !== "silent" && !quipped.has(kind)) {
        if (kind !== "near_line" && kind !== "cleared") quipped.add(kind);
        say(`co_${kind}` as LineId);
      }
      // How to accuse, on the first reveals of the night, until someone does.
      if (has("accuse") && nudges < 2 && hands === 0 && m.questionIdx <= 2 && say("accuse_open", { mode: "aside" })) nudges++;
      break;
    }
    case "vote": {
      // v0.23: "…Everybody, vote!" waits for the ballots to open, after the
      // accused has had the floor. A v0.22 vote (no floor) calls it at once.
      const opensAt = m?.vote?.opensAt;
      if (has("in")) hands++;
      if (opensAt === undefined ? has("in") && fresh : has("open") && serverNow() - opensAt < FRESH_MS) say(take("vote_a", "vote_b"));
      if (has("urgent") && s.players.some((p) => p.connected && p.votingRights && !p.banished && !p.votedCurrent)) say("vote_urgent", { mode: "aside" });
      break;
    }
    case "voteResult": {
      const vr = m?.voteResult;
      if (!m || !vr || !has("verdict")) break;
      const strikes = s.settings.strikes;
      const grace = { wait: 1500 }; // a vote call still running: she finishes it first
      if (vr.tie || !vr.banishedId) say("vr_tie", grace);
      else if (vr.wasCheater) say("vr_caught", grace);
      else if (strikes > 0 && m.wrongDetentions >= strikes) say("vr_struckout", grace);
      else {
        say("vr_innocent", grace);
        // One strike left: the next wrong detention ends the period.
        if (strikes > 0 && m.wrongDetentions === strikes - 1) say("vr_strike", { mode: "next", wait: 10000 });
      }
      break;
    }
    case "matchEnd": {
      const e = m?.end;
      if (!e) break;
      if (has("takeover") && fresh) {
        // A quick teacher's Continue lands mid-verdict: she finishes it first.
        if (e.reason === "cheater_banished") say("me_caught", { wait: 2000 });
        else if (e.reason === "cheater_threshold") {
          if (!e.struckOut) say("me_graduated", { wait: 2000 }); // struck out: the verdict already said so
        } else {
          const unmaskAt = s.phaseStartedAt + matchEndTimeline(e.reason).beats.unmask;
          sayTimed(["me_drumroll"], (c) => unmaskAt - DRUM_GAP - c.end);
        }
      }
      if (has("scores") && e.reason === "top_score") say("me_top", { mode: "next", wait: 2000 });
      break;
    }
    case "sessionEnd":
      if (has("crown")) say("se_crown", { wait: 2000 });
      break;
  }
}
