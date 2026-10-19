// 3. Role assign (spec 07, 08 §4): the bell rings and class begins.
//   bell  0     the school bell swings and rings (sound-wave rings), chalk dust
//               shaken loose drifts down, the room slowly dims (0–1700)
//   line1 350   "Class is in session." rises
//   line2 1000  "Someone in this class is cheating…" rises
//   role  1700  a folded note slides up with YOUR line; the bell dings once more
//   (2400 "pencils ready" hint; the engine moves on to the question at 3200)
//
// PARITY: identical look, timing and motion for everyone. Both role lines have
// the same length, weight and colour, sit in the same reserved box, and are
// rendered only from the role beat — never when the secret packet arrives.
// The line text is the only thing on this screen that depends on the secret.
import { reached, ROLE_TIMELINE, type RoleBeat } from "../../../shared/choreo";
import type { Screen } from "./types";

// Same emoji on both: a yellow 😎 vs white 👀 was readable from across a room.
export const CHEATER_LINE = "It's you. Play it cool. 🤫";
export const INNOCENT_LINE = "Not you. Watch closely. 🤫";
/** In the hallway (v0.7): not playing this period, so no role at all. */
export const HALLWAY_LINE = "Hallway. Watch and learn. 👀";

/** When each group's motion has certainly finished. Later renders (and late
 *  joins) drop those animations; keyframes are from-only, so the resting look
 *  is the element's own style and nothing visibly changes. */
// swing 0–1200 (rings to 1480) · dim 0–1700 · line1 350–800 · line2 1000–1450 ·
// role: note 1700–2150, ding –2300, ring –2600, hint 2400–2640 · dust ≤2900
const DONE_AT = { swing: 1500, dim: 1800, line1: 950, line2: 1600, role: 2800, dust: 3000 } as const;

/** Chalk dust shaken loose by the bell: [left %, top %, delay ms, size px, drift px].
 *  Fixed (no randomness), so every phone renders the same frame. */
const DUST: [number, number, number, number, number][] = [
  [8, 14, 60, 6, 150], [17, 26, 380, 4, 120], [26, 9, 160, 7, 170], [35, 31, 520, 4, 135], [44, 18, 240, 6, 160], [53, 7, 640, 4, 125],
  [61, 22, 100, 7, 175], [70, 12, 450, 4, 140], [79, 28, 300, 6, 155], [88, 16, 560, 4, 130], [94, 6, 200, 5, 165], [3, 33, 700, 4, 120],
];

export const role: Screen = {
  beatKey: ({ elapsed }) => [...reached(ROLE_TIMELINE, elapsed)].join(","),
  render({ app, s, elapsed }) {
    const b = reached(ROLE_TIMELINE, elapsed);
    const cls = [...b].map((x: RoleBeat) => `b-${x}`);
    for (const [k, at] of Object.entries(DONE_AT)) if (elapsed >= at) cls.push(`d-${k}`);
    // Both lines are "X you. <advice> <emoji>" (26 chars each). The first space
    // becomes a newline (white-space: pre-line) so each note is exactly two
    // lines in a full-width block: identical boxes whatever the glyph widths,
    // no extra element, same text length.
    const seated = s.players.some((p) => p.id === app.selfId);
    const line = (!seated ? HALLWAY_LINE : app.secret.isCheater ? CHEATER_LINE : INNOCENT_LINE).replace(". ", ".\n");
    const dust = DUST.map(([x, top, d, s, y]) => `<i style="--x:${x}%;--top:${top}%;--d:${d}ms;--s:${s}px;--y:${y}px"></i>`).join("");
    return `<section class="screen screen-role ${cls.join(" ")}">
      <hd-roleroom class="rl">
        <div class="rl-dim" aria-hidden="true"></div>
        <div class="rl-dust" aria-hidden="true">${dust}</div>
        <div class="rl-stage">
          <div class="rl-bell" aria-hidden="true">
            <span class="rl-mount"></span>
            <span class="rl-ring r1"></span><span class="rl-ring r2"></span><span class="rl-ring r3"></span>
            <span class="rl-glyph">🔔</span>
          </div>
          <h1 class="rl-l1">Class is in session.</h1>
          <p class="rl-l2">Someone in this class is cheating…</p>
          <div class="rl-slot">${
            b.has("role")
              ? `<div class="rl-note" id="rl-note"><span class="rl-note-tag">📝 Psst… your note</span><span class="rl-line">${line}</span></div>`
              : ""
          }</div>
        </div>
        <p class="rl-hint" aria-hidden="true">✏️ Pencils ready…</p>
      </hd-roleroom>
    </section>`;
  },
};
