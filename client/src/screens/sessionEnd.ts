// 8. Session end (spec 07 §8; 08-reveal-direction.md §4): graduation day.
// Podium columns rise 3rd → 2nd → 1st (scaleY from the bottom, 300ms
// apart), the VALEDICTORIAN stamp lands with confetti, then the final
// standings cascade. Beats are a local timeline on the shared clock (pure
// function of the player count), exposed as b-<beat> classes on the root so
// a late arrival renders settled. Every box is reserved from frame 0.
import type { PublicPlayer, PublicState } from "../../../shared/protocol";
import { esc } from "./common";
import type { RenderCtx, Screen } from "./types";

type SessionBeat = "start" | "rise3" | "rise2" | "rise1" | "crown" | "list" | "done";

const RISE_GAP = 300; // podium columns, 3rd → 2nd → 1st
const LIST_STAGGER = 110; // standings cascade (order = rank: information-bearing)

/** Beat times (ms from the phase start). The first column waits for the
 *  page-turn View Transition (--t-scene, 450ms) plus headroom: renders are
 *  deferred while a transition runs, and a late end must not land two
 *  columns on the same frame. */
function timeline(players: number): Record<SessionBeat, number> {
  const rise3 = 600;
  const rise1 = rise3 + 2 * RISE_GAP; // 1200
  const crown = rise1 + 650; // 1st column (450ms) + its figure have landed
  const list = crown + 500;
  return { start: 0, rise3, rise2: rise3 + RISE_GAP, rise1, crown, list, done: list + players * LIST_STAGGER + 240 };
}

function reachedBeats(ctx: RenderCtx): SessionBeat[] {
  const tl = timeline(ctx.s.players.length);
  return (Object.keys(tl) as SessionBeat[]).filter((b) => ctx.elapsed >= tl[b]);
}

const pts = (s: PublicState, id: string) => s.sessionBoard[id] ?? 0;

/** Standard competition ranks (1, 1, 3) for an already-sorted list. */
function compRanks(scores: number[]): number[] {
  const out: number[] = [];
  scores.forEach((sc, i) => out.push(i > 0 && sc === scores[i - 1] ? out[i - 1] : i + 1));
  return out;
}

/** Deterministic 0..1 noise: identical confetti on every phone and render. */
const noise = (k: number) => {
  const x = Math.sin(k * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
};
const COLORS = ["var(--accent2)", "var(--good)", "var(--cleared)", "var(--accent)", "var(--ink)"];

function confetti(count: number): string {
  let out = "";
  for (let i = 0; i < count; i++) {
    const bx = Math.round((noise(i + 7) - 0.5) * 360);
    const by = Math.round(-40 - noise(i + 47) * 110);
    const rot = Math.round(300 + noise(i + 87) * 600) * (i % 2 ? 1 : -1);
    const delay = Math.round(i * 20 + noise(i + 127) * 90);
    const dur = Math.round(2400 + noise(i + 167) * 1000);
    out += `<i class="${["", "c", "s"][i % 3]}" id="se-cnf-${i}" style="--bx:${bx}px;--by:${by}px;--rot:${rot}deg;background:${COLORS[i % 5]};animation-delay:${delay}ms;animation-duration:${dur}ms"></i>`;
  }
  return out;
}

const BLOCK_H: Record<number, number> = { 1: 128, 2: 96, 3: 72 }; // by rank
const ORDINAL: Record<number, string> = { 1: "1st", 2: "2nd", 3: "3rd" };
const MEDAL: Record<number, string> = { 1: "🥇", 2: "🥈", 3: "🥉" };

function badges(p: PublicPlayer): string {
  return (p.isHost ? `<span class="badge host">TEACHER</span>` : "") + (p.isBot ? `<span class="badge bot">BOT</span>` : "");
}

export const sessionEnd: Screen = {
  beatKey: (ctx) => reachedBeats(ctx).join(","),
  render(ctx) {
    const { app, s } = ctx;
    const b = new Set(reachedBeats(ctx));
    const sorted = [...s.players].sort((a, c) => pts(s, c.id) - pts(s, a.id)); // stable: ties keep seat order
    const rk = compRanks(sorted.map((p) => pts(s, p.id)));
    const champs = sorted.filter((_, i) => rk[i] === 1);
    const periods = `${s.matchNumber} period${s.matchNumber === 1 ? "" : "s"}`;

    // Podium: DOM (and screen) order is 2nd · 1st · 3rd; place = position in
    // the standings, height = competition rank (a tie stands level).
    const column = (place: 1 | 2 | 3) => {
      const p = sorted[place - 1];
      if (!p) return `<div class="se-col se-p${place} se-empty" aria-hidden="true"></div>`;
      const r = rk[place - 1];
      return `<div class="se-col se-p${place} se-r${Math.min(r, 3)}" id="se-col-${place}" style="--h:${BLOCK_H[Math.min(r, 3)]}px">
        <div class="se-fig">
          <span class="se-av" aria-hidden="true">${p.avatar}</span>
          <span class="se-nm" title="${esc(p.name)}">${esc(p.name)}</span>
          <span class="se-pts">${pts(s, p.id)} pts</span>
        </div>
        <div class="se-block"><span class="se-place">${ORDINAL[Math.min(r, 3)]}</span></div>
      </div>`;
    };

    const stamp = b.has("crown")
      ? `<span class="se-stamp" id="se-stamp">${champs.length > 1 ? "CO-VALEDICTORIANS" : "VALEDICTORIAN"}</span>
         <span class="se-sr">${champs.map((p) => esc(p.name)).join(" and ")}, with ${pts(s, champs[0]?.id ?? "")} semester points</span>`
      : "";

    const rows = b.has("list")
      ? sorted
          .map(
            (p, i) => `<div class="se-row${p.id === app.selfId ? " self" : ""}" id="se-row-${p.id}" role="listitem" style="--i:${i}">
              <span class="se-rank">${MEDAL[rk[i]] ? `<span role="img" aria-label="rank ${rk[i]}">${MEDAL[rk[i]]}</span>` : rk[i]}</span>
              <span class="av" aria-hidden="true">${p.avatar}</span>
              <span class="se-row-nm" title="${esc(p.name)}">${esc(p.name)}</span>${badges(p)}
              <span class="se-row-pts">${pts(s, p.id)}</span>
            </div>`,
          )
          .join("")
      : "";

    const dock = b.has("done")
      ? `<button class="btn" data-action="home" id="se-home">🏫 Back to school</button>
         ${app.isHost ? `<button class="btn ghost" data-action="downloadLog" id="se-log">⬇ Download session log</button>` : ""}`
      : "";

    return `<section class="screen screen-sessionEnd ${[...b].map((x) => `b-${x}`).join(" ")}" aria-label="Final standings">
      <div class="se-confetti" aria-hidden="true">${b.has("crown") ? confetti(24) : ""}</div>
      <header class="se-head">
        <div class="se-kick">🎓 Graduation day</div>
        <h1 class="se-title">Class of ${esc(s.roomCode)}</h1>
        <p class="se-sub">${periods} · final report</p>
      </header>
      <div class="se-podium" role="group" aria-label="Podium">
        <div class="se-stamp-row" role="status">${stamp}</div>
        ${column(2)}${column(1)}${column(3)}
      </div>
      <section class="card se-standings" aria-labelledby="se-standings-h">
        <h2 id="se-standings-h">📊 Final standings</h2>
        <div class="se-list" role="list" style="--n:${sorted.length}">${rows}</div>
      </section>
      <div class="se-dock${app.isHost ? " host" : ""}">${dock}</div>
    </section>`;
  },
};
