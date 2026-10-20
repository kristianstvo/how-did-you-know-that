// Shared pieces used by several screens. Pure string builders.
import type { CaseEntry, PublicPlayer, PublicState } from "../../../shared/protocol";
import { soundOn } from "../sound";
import type { App } from "./types";
import { face } from "../avatars";

export const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export const LETTERS = ["A", "B", "C", "D"];

export const playerOf = (s: PublicState, id: string) => s.players.find((p) => p.id === id);

export const nameOf = (s: PublicState, id: string) => {
  const p = playerOf(s, id);
  return p ? `${face(p.avatar)} ${esc(p.name)}` : "???";
};

export const av = (p: PublicPlayer, extra = "") => `<span class="av ${extra}" aria-hidden="true">${face(p.avatar)}</span>`;

export const fmtTime = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

export function playerBadges(p: PublicPlayer, s?: PublicState): string {
  let out = "";
  if (p.isHost) out += `<span class="badge host">TEACHER</span>`;
  if (p.isBot) out += `<span class="badge bot">BOT</span>`;
  if (p.banished) out += `<span class="badge banished">DETENTION</span>`;
  if (s?.match?.cleared.includes(p.id)) out += `<span class="badge cleared">CLEARED</span>`;
  if (!p.connected && !p.isBot) out += `<span class="badge recon">reconnecting…</span>`;
  return out;
}

/** Playtest tools (event-log downloads) only with ?playtest in the URL:
 *  the teacher's dock is for the class, not for debugging (v0.15). */
export const PLAYTEST = typeof location !== "undefined" && new URLSearchParams(location.search).has("playtest");

export const CALLOUT_ICON: Record<string, string> = {
  lone_correct: "🎯",
  against_crowd: "🐑",
  lightning: "⏱️",
  streak: "🔥",
  hard_sweep: "💯",
  near_line: "🎓",
  stumper: "🤯",
  cleared: "✅",
};

/** School-themed copy for each evidence callout: an OBSERVATION plus a
 *  QUESTION, never a verdict — against a disciplined cheater every callout
 *  points at them only ~1.3× more often than chance (sim). `who` is escaped. */
export function calloutCopy(e: CaseEntry, s: PublicState): { icon: string; title: string; line: string; ask: string } {
  const who = e.subjectIds.map((id) => nameOf(s, id)).join(" & ");
  const many = e.subjectIds.length > 1;
  const secs = (ms: number) => (ms / 1000).toFixed(1);
  const icon = CALLOUT_ICON[e.kind] ?? "🔎";
  switch (e.kind) {
    case "lone_correct":
      return { icon, title: "Only one got it", line: `${who} was the only one who knew this.`, ask: "Genius… or cheat sheet?" };
    case "against_crowd":
      return { icon, title: "Against the herd", line: `${e.detail.crowd} classmates fell for the same trap. ${who} didn't.`, ask: "Lucky, or looking?" };
    case "lightning":
      return { icon, title: "Pencil never stopped", line: `${who}: ${secs(e.detail.timeMs ?? 0)}s. The class: ${secs(e.detail.roomMedianMs ?? 0)}s.`, ask: "Fast fingers, or a peek?" };
    case "streak":
      return { icon, title: `${e.detail.streak} in a row`, line: `${who} ${many ? "haven't" : "hasn't"} missed in ${e.detail.streak} questions.`, ask: "Teacher's pet?" };
    case "hard_sweep":
      return { icon, title: "Perfect on the hard ones", line: `${who} aced every hard question so far.`, ask: "Who studies THAT much?" };
    case "near_line":
      return { icon, title: "Almost graduating", line: `${who} ${many ? "are" : "is"} ${e.detail.gap} points from the line.`, ask: "If it's them, it's now or never." };
    case "stumper":
      return { icon, title: "Stumped the class", line: "Nobody got it. Not even the cheater.", ask: "Someone's playing it safe." };
    case "cleared":
      return e.detail.absent
        ? { icon, title: "Cleared", line: `${who} wasn't in class at the bell.`, ask: "Can't be the cheater." }
        : { icon, title: "Cleared", line: `${who} crossed the line. No siren.`, ask: "Proven innocent." };
    default:
      return { icon, title: "Evidence", line: who, ask: "" };
  }
}

/** Exhibit icons pinned to a player (every announced callout naming them). */
export function exhibitBadges(s: PublicState, playerId: string, upToQ = Infinity): string {
  const icons = (s.match?.caseFile ?? [])
    .filter((e) => e.q <= upToQ && e.kind !== "cleared" && e.kind !== "stumper" && e.subjectIds.includes(playerId))
    .map((e) => `<span class="exhibit" title="Q${e.q + 1}">${CALLOUT_ICON[e.kind] ?? "🔎"}</span>`);
  return icons.length ? `<span class="exhibits" role="img" aria-label="${icons.length} exhibit${icons.length === 1 ? "" : "s"}">${icons.join("")}</span>` : "";
}

// ---- Pointing (v0.5): free, public "I suspect you" ----

/** Everyone currently pointing at this player. */
export const pointersAt = (s: PublicState, id: string) => s.players.filter((p) => (p.pointingAt ?? null) === id);

/** "👉3" with who is pointing in the tooltip; "" when nobody is. */
export function pointerChip(s: PublicState, id: string): string {
  const by = pointersAt(s, id);
  if (!by.length) return "";
  const names = esc(by.map((p) => p.name).join(", "));
  return `<span class="ptr" role="img" aria-label="${by.length} pointing: ${names}" title="Pointed at by ${names}">👉${by.length}</span>`;
}

/** The sheet behind the 👉 button: one 52px row per classmate (thumb-sized),
 *  with who already points at them. A tap points and closes. */
export function pointSheet(app: App, s: PublicState): string {
  if (!app.ui.pointOpen) return "";
  const mine = s.players.find((p) => p.id === app.selfId)?.pointingAt ?? null;
  const rows = s.players
    .filter((p) => p.id !== app.selfId && !p.banished)
    .map((p) => {
      const by = pointersAt(s, p.id);
      const on = mine === p.id;
      return `<button class="pt-row${on ? " on" : ""}" id="pt-${p.id}" data-action="point" data-id="${p.id}" aria-pressed="${on}" aria-label="Point at ${esc(p.name)}${by.length ? `, ${by.length} already pointing` : ""}">
        ${av(p)}<span class="pt-nm">${esc(p.name)}</span>${exhibitBadges(s, p.id)}
        <span class="pt-by" aria-hidden="true">${by.map((x) => `<span class="pt-by-av" title="${esc(x.name)}">${face(x.avatar)}</span>`).join("")}</span>
        ${on ? `<span class="pt-on" aria-hidden="true">👉 you</span>` : ""}
      </button>`;
    })
    .join("");
  return `<div class="overlay pt-sheet" id="pt-sheet" role="dialog" aria-modal="true" aria-labelledby="pt-h" data-action="pointSheet">
    <div class="pt-card" data-action="noop">
      <h2 id="pt-h">👉 Point at a suspect</h2>
      <p class="pt-sub">Free, public, changeable. Not a vote: it shows the class who you suspect.</p>
      <div class="pt-list">${rows}</div>
      ${mine ? `<button class="btn ghost pt-stop" id="pt-stop" data-action="point" data-id="">Stop pointing</button>` : ""}
    </div>
    <button class="btn secondary pt-close" id="pt-close" data-action="pointSheet">Close</button>
  </div>`;
}

/** The three acts the data produces: ~0% / ~73% / ~95% of reveals carry
 *  evidence on easy / medium / hard questions. */
export function actOf(questionIdx: number): { n: string; name: string } {
  if (questionIdx < 3) return { n: "Act I", name: "Warm-up" };
  if (questionIdx < 7) return { n: "Act II", name: "Pop quiz" };
  return { n: "Act III", name: "Final exam" };
}

export const tierTicks = (tier: string) => (tier === "easy" ? "●○○" : tier === "medium" ? "●●○" : "●●●");

/** LAST BELL copy: who would graduate next question if they're the cheater. */
export function lastBellLine(s: PublicState, ids: string[]): string {
  if (!ids.length) return "";
  const names = ids.map((id) => nameOf(s, id)).join(", ");
  return `🔔 LAST BELL — if it's ${names}, they graduate next question.`;
}

/** Case file: every announced callout this match, per player. */
export function caseCounts(s: PublicState): Map<string, CaseEntry[]> {
  const m = new Map<string, CaseEntry[]>();
  for (const e of s.match?.caseFile ?? []) {
    if (e.kind === "cleared" || e.kind === "stumper") continue;
    for (const id of e.subjectIds) m.set(id, [...(m.get(id) ?? []), e]);
  }
  return m;
}

export function sessionRows(s: PublicState, delta?: (id: string) => string): string {
  const sorted = [...s.players].sort((a, b) => (s.sessionBoard[b.id] ?? 0) - (s.sessionBoard[a.id] ?? 0));
  return sorted
    .map(
      (p, i) => `<div class="player-li" id="sess-${p.id}">
        <span class="rank">${i + 1}</span>
        ${av(p)}<span class="nm">${esc(p.name)}</span>
        ${delta ? delta(p.id) : ""}
        <span class="pts">${s.sessionBoard[p.id] ?? 0}</span>
      </div>`,
    )
    .join("");
}

/** Floating semester-standings tab + overlay sheet. Hidden during a vote and
 *  its result: session points for the vote land before the verdict stamp, so
 *  live totals would give the outcome away. */
/** 🔊 / 🔇 — one switch for every game sound (remembered on this phone). */
export function soundToggle(extra = ""): string {
  const on = soundOn();
  return `<button class="snd ${extra}" id="snd-${extra || "btn"}" data-action="toggleSound" aria-pressed="${on}" aria-label="Sound ${on ? "on" : "off"}" title="Sound ${on ? "on" : "off"}"><span aria-hidden="true">${on ? "🔊" : "🔇"}</span></button>`;
}

export function sessionTab(app: App, s: PublicState): string {
  if (s.matchNumber === 0 || s.phase === "vote" || s.phase === "voteResult") return "";
  const open = app.ui.boardOpen;
  const overlay = open
    ? `<div class="overlay" data-action="toggleBoard" role="dialog" aria-modal="true" aria-label="Today's gold stars">
        <div class="card sheet"><h2>⭐ Today's gold stars ${soundToggle("in-sheet")}</h2>${sessionRows(s)}
          <button class="btn secondary" data-action="toggleBoard" autofocus>Close</button>
        </div>
      </div>`
    : "";
  return `<button class="sess-tab" data-action="toggleBoard" aria-label="Today's gold stars" aria-expanded="${open}">⭐</button>${overlay}`;
}

/** Players ordered by answer speed (fastest first, no-answers last) — the
 *  order avatars slap onto the board. Public data only. */
export function speedOrder(s: PublicState): string[] {
  const rows = s.match?.reveal?.rows ?? [];
  return [...rows]
    .sort((a, b) => (a.pick === -1 ? 1 : 0) - (b.pick === -1 ? 1 : 0) || a.timeMs - b.timeMs || a.playerId.localeCompare(b.playerId))
    .map((r) => r.playerId);
}
