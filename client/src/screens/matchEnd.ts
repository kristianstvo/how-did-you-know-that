// 7. Match end (spec 07; 08-reveal-direction.md §4): three variants staged on
// the shared clock with matchEndTimeline (shared/choreo.ts).
//   graduated (cheater_threshold): siren takeover → FINAL BLOW card → unmask
//   caught / top of class:          banner (+confetti on caught) → drumroll →
//                                   unmask
//   then all: report card → case-file recap → semester deltas → host dock.
// Every phone (the cheater's included) renders the same beats and layout. The
// cheater's identity never reaches the DOM before the unmask beat: the hero
// shows a redacted yearbook photo, and every section that would imply who it
// was (🏆, CHEATER badge, case-file grouping, semester deltas) is only built
// on a later beat. Boxes are reserved from frame 0 (fixed row heights ×
// counts, see matchEnd.css), so beats never reflow.
import { matchEndTimeline, reached, type MatchEndBeat } from "../../../shared/choreo";
import type { CaseEntry, PublicPlayer, PublicState } from "../../../shared/protocol";
import { calloutCopy, esc, fmtTime, playerBadges } from "./common";
import type { RenderCtx, Screen } from "./types";

type Variant = "caught" | "graduated" | "top";
type MatchState = NonNullable<PublicState["match"]>;
type End = NonNullable<MatchState["end"]>;

const variantOf = (e: End): Variant =>
  e.reason === "cheater_banished" ? "caught" : e.reason === "cheater_threshold" ? "graduated" : "top";

/** The beat each variant doesn't stage. matchEndTimeline puts it on the same
 *  ms as another beat (graduation: drumroll = takeover = 0; caught/top:
 *  finalBlow = unmask = 2500). Counting it would make the shell think two
 *  beats were crossed at once and SETTLE (skip) the takeover / the unmask. */
const UNSTAGED: Record<Variant, MatchEndBeat> = { graduated: "drumroll", caught: "finalBlow", top: "finalBlow" };

function beats(ctx: RenderCtx) {
  const e = ctx.s.match!.end!;
  const v = variantOf(e);
  const tl = matchEndTimeline(e.reason);
  const b = reached(tl, ctx.elapsed);
  b.delete(UNSTAGED[v]);
  return { v, tl, b };
}

/** Standard competition ranks (1, 1, 3) for an already-sorted score list. */
function compRanks(scores: number[]): number[] {
  const out: number[] = [];
  scores.forEach((sc, i) => out.push(i > 0 && sc === scores[i - 1] ? out[i - 1] : i + 1));
  return out;
}

/** Deterministic 0..1 noise so confetti renders identically on every phone
 *  and on every re-render (a re-render must not change a particle's style). */
const noise = (k: number) => {
  const x = Math.sin(k * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
};
const CONFETTI_COLORS = ["var(--good)", "var(--accent2)", "var(--cleared)", "var(--accent)", "var(--ink)"];

function confetti(from: number, count: number, beatDelay: number): string {
  let out = "";
  for (let i = from; i < from + count; i++) {
    const shape = ["", "c", "s"][i % 3];
    const bx = Math.round((noise(i) - 0.5) * 340); // burst spread from the banner
    const by = Math.round(-30 - noise(i + 40) * 90);
    const rot = Math.round(300 + noise(i + 80) * 600) * (i % 2 ? 1 : -1);
    const delay = beatDelay + Math.round((i - from) * 22 + noise(i + 120) * 80);
    const dur = Math.round(2300 + noise(i + 160) * 900);
    out += `<i class="${shape}" id="me-cnf-${i}" style="--bx:${bx}px;--by:${by}px;--rot:${rot}deg;background:${CONFETTI_COLORS[i % 5]};animation-delay:${delay}ms;animation-duration:${dur}ms"></i>`;
  }
  return out;
}

const BANNER: Record<Variant, { kick: string; title: string; sub: string }> = {
  caught: { kick: "🎉 Class dismissed", title: "Cheater caught!", sub: "The class vote sent them to the principal." },
  graduated: { kick: "🚨 Alarm bells 🚨", title: "The cheater graduated", sub: "They crossed the line. Nobody stopped them." },
  top: { kick: "🔔 Final bell", title: "Top of the class", sub: "Nobody graduated early. Highest score wins." },
};

function banner(v: Variant): string {
  const t = BANNER[v];
  return `<header class="me-banner" id="me-banner" role="alert">
    <div class="me-kick">${t.kick}</div>
    <h1 class="me-title">${t.title}</h1>
    <p class="me-subt">${t.sub}</p>
  </header>`;
}

/** The hero: a yearbook photo that stays redacted until the unmask beat.
 *  Graduated: it's the FINAL BLOW card (the answer that did it, then who).
 *  Caught / top: "The cheater was…" with a chalk drumroll bar. */
function hero(ctx: RenderCtx, v: Variant, b: Set<MatchEndBeat>, drum: { at: number; dur: number }): string {
  const { s } = ctx;
  const m = s.match!;
  const e = m.end!;
  const cheater = s.players.find((p) => p.id === e.cheaterId);
  const unmasked = b.has("unmask") && !!cheater;

  const face = unmasked
    ? `<span class="me-face-real" id="me-face-real" aria-hidden="true">${cheater!.avatar}</span>`
    : `<span class="me-face-mask" id="me-face-mask" aria-hidden="true">?</span>`;
  const stamp = unmasked ? `<span class="me-stamp-wrap"><span class="me-stamp" id="me-stamp">CHEATER</span></span>` : "";
  const name = unmasked
    ? `<span class="me-name" id="me-name" title="${esc(cheater!.name)}">${esc(cheater!.name)}</span>`
    : `<span class="me-redact" id="me-redact" aria-hidden="true"></span><span class="me-sr">not revealed yet</span>`;
  const photo = `<div class="me-face">${face}${stamp}</div>`;

  if (v === "graduated") {
    const q = m.question;
    const r = m.reveal;
    const row = r?.rows.find((x) => x.playerId === e.cheaterId);
    const vr = m.voteResult;
    const lineDrop = !!vr && !vr.wasCheater && vr.newThreshold !== null;
    const qLabel = `Q${m.questionIdx + 1}`;
    const score = cheater?.score ?? 0;
    const blow = b.has("finalBlow");
    let answer = "";
    if (row && q && row.pick >= 0) {
      const opt = esc(q.options[row.pick] ?? "");
      answer = `<span class="me-fx">answered “</span><span class="me-opt" title="${opt}">${opt}</span><span class="me-fx">” <b class="${row.correct ? "me-ok" : "me-no"}">${row.correct ? "✓" : "✗"}</b> in ${fmtTime(row.timeMs)}</span>`;
    } else if (row) {
      answer = `<span class="me-fx">left ${qLabel} blank 🤐</span>`;
    }
    const pts = lineDrop
      ? `<b>${score}</b>&nbsp;🎓 <span class="me-dimtxt">over the line (${m.threshold})</span>`
      : `${row?.pointsGained ? `<b>+${row.pointsGained}</b> → ` : ""}<b>${score}</b>&nbsp;🎓 <span class="me-dimtxt">line ${m.threshold}</span>`;
    const banished = lineDrop && vr!.banishedId ? s.players.find((p) => p.id === vr!.banishedId) : undefined;
    const drop = banished
      ? `📉 ${banished.avatar} <b class="me-drop-nm" title="${esc(banished.name)}">${esc(banished.name)}</b>’s detention lowered the line: ${vr!.newThreshold! + s.settings.thresholdDrop} → ${vr!.newThreshold}`
      : "";
    return `<div class="card me-hero me-blow" id="me-hero" role="status" aria-live="polite" aria-atomic="false">
      <div class="me-hk">💥 Final blow · ${qLabel}${q ? ` · ${q.subjectEmoji} ${esc(q.subject)}` : ""}</div>
      <p class="me-qtext">${blow && q ? `<span id="me-qtext">${esc(q.text)}</span>` : ""}</p>
      <div class="me-id">
        ${photo}
        <div class="me-who">
          <div class="me-name-slot">${name}</div>
          <div class="me-blow-l">${blow ? `<span class="me-blow-in" id="me-blow-1" style="--i:0">${answer}</span>` : ""}</div>
          <div class="me-blow-l">${blow ? `<span class="me-blow-in" id="me-blow-2" style="--i:1">${pts}</span>` : ""}</div>
        </div>
      </div>
      ${lineDrop ? `<div class="me-drop">${blow ? `<span class="me-blow-in" id="me-blow-3" style="--i:2">${drop}</span>` : ""}</div>` : ""}
    </div>`;
  }

  // Caught / top of class: drumroll → unmask.
  const vr = m.voteResult;
  let sub = "";
  if (unmasked) {
    if (v === "caught") {
      sub = vr && vr.wasCheater ? `🗳️ Caught by ${vr.tallies[e.cheaterId] ?? 0} of ${Object.keys(vr.votes).length} votes` : "🗳️ Caught by the class vote";
    } else {
      const won = e.winnerIds.includes(e.cheaterId);
      sub = won ? `🏆 ${e.winnerIds.length > 1 ? "Tied for top" : "Top of the class"} · never caught` : `🤫 Never caught · ${cheater!.score} pts`;
    }
  }
  const into = Math.round(Math.max(0, Math.min(drum.dur, ctx.elapsed - drum.at)));
  const fill = b.has("drumroll")
    ? `<span class="me-drum-fill" id="me-drum-fill" data-keep-style style="animation-duration:${drum.dur}ms;animation-delay:-${into}ms"></span>`
    : "";
  const slot = unmasked
    ? `<div class="me-sub" id="me-sub">${sub}</div>`
    : `<div class="me-drum" id="me-drum" aria-hidden="true">${fill}</div>`;
  return `<div class="card me-hero" id="me-hero" role="status" aria-live="polite" aria-atomic="false">
    <div class="me-hk">The cheater was<span class="me-dots" aria-hidden="true"><i>.</i><i>.</i><i>.</i></span></div>
    <div class="me-id">
      ${photo}
      <div class="me-who">
        <div class="me-name-slot">${name}</div>
        <div class="me-sub-slot">${slot}</div>
      </div>
    </div>
  </div>`;
}

/** Report card: final match scores, a grade-book bar against the line,
 *  🏆 for the winners and the CHEATER badge — built at the scores beat,
 *  which is always after the unmask. */
function reportCard(ctx: RenderCtx, b: Set<MatchEndBeat>): string {
  const { s, app } = ctx;
  const m = s.match!;
  const e = m.end!;
  const sorted = [...s.players].sort((a, c) => c.score - a.score); // stable: ties keep seat order
  const rk = compRanks(sorted.map((p) => p.score));
  const top = Math.max(m.threshold, ...sorted.map((p) => p.score), 1) * 1.08;
  const linePct = ((m.threshold / top) * 100).toFixed(2);
  const rows = b.has("scores")
    ? sorted
        .map((p, i) => {
          const win = e.winnerIds.includes(p.id);
          const isCheater = p.id === e.cheaterId;
          const share = (Math.max(0, p.score) / top).toFixed(4);
          return `<div class="me-rc-row${win ? " win" : ""}${isCheater ? " is-cheater" : ""}${p.id === app.selfId ? " self" : ""}" id="me-rc-${p.id}" role="listitem" style="--i:${i}">
            <span class="me-rank">${rk[i]}</span>
            <span class="av" aria-hidden="true">${p.avatar}</span>
            <span class="me-rc-main">
              <span class="me-rc-top"><span class="me-nm" title="${esc(p.name)}">${esc(p.name)}</span>${isCheater ? `<span class="badge me-badge-cheater">CHEATER</span>` : ""}${playerBadges(p, s)}</span>
              <span class="me-bar" aria-hidden="true"><span class="me-bar-fill" style="--share:${share}"></span><span class="me-bar-line"></span></span>
            </span>
            <span class="me-score">${p.score}</span>
            <span class="me-trophy">${win ? `<span role="img" aria-label="winner">🏆</span>` : ""}</span>
          </div>`;
        })
        .join("")
    : "";
  return `<section class="card me-sec me-rc" id="me-rc" aria-labelledby="me-rc-h">
    <h2 class="me-h" id="me-rc-h"><span>📄 Report card · Period ${s.matchNumber}</span><span class="me-aside">🎓 line ${m.threshold}</span></h2>
    <div class="me-rc-list" role="list" style="--n:${sorted.length};--line:${linePct}%">${rows}</div>
  </section>`;
}

/** Case-file recap: which exhibits pointed at the cheater, which pointed at
 *  innocents. Evidence, not proof. Built at the caseFile beat (after the
 *  unmask) — the grouping itself names the cheater. */
function caseFileRecap(ctx: RenderCtx, b: Set<MatchEndBeat>): string {
  const { s } = ctx;
  const e = s.match!.end!;
  // CLEARED is proof of innocence, not evidence against anyone: it isn't an
  // exhibit (same rule as exhibitBadges) and never counts in the hit rate.
  const indexed = (s.match!.caseFile ?? []).map((x, idx) => ({ x, idx })).filter(({ x }) => x.kind !== "stumper" && x.kind !== "cleared");
  const hit = indexed.filter(({ x }) => x.subjectIds.includes(e.cheaterId));
  const miss = indexed.filter(({ x }) => !x.subjectIds.includes(e.cheaterId));
  const show = b.has("caseFile");
  let k = 0; // cascade index (headers and lines, top to bottom)

  const line = ({ x, idx }: { x: CaseEntry; idx: number }, cls: string) => {
    const c = calloutCopy(x, s);
    const who = x.subjectIds.map((id) => s.players.find((p) => p.id === id)).filter((p): p is PublicPlayer => !!p);
    const names = esc(who.map((p) => p.name).join(", "));
    const whoHtml =
      who.length === 1
        ? `${who[0].avatar}&nbsp;${esc(who[0].name)}`
        : who.map((p) => `<span class="${p.id === e.cheaterId ? "me-cf-hit" : ""}">${p.avatar}</span>`).join("");
    return `<div class="me-cf-line ${cls}" id="me-cf-${idx}" style="--i:${k++}">
      <span class="me-cf-ic" aria-hidden="true">${c.icon}</span>
      <span class="me-cf-q">Q${x.q + 1}</span>
      <span class="me-cf-title">${c.title}</span>
      <span class="me-cf-who" title="${names}">${whoHtml}</span>
    </div>`;
  };
  const group = (cls: string, glyph: string, label: string, list: typeof indexed) =>
    `<div class="me-cf-group ${cls}" id="me-cfg-${cls}" style="--i:${k++}"><b class="me-cf-glyph" aria-hidden="true">${glyph}</b>${label} · ${list.length || "none"}</div>` +
    list.map((it) => line(it, cls)).join("");

  const body = !show
    ? ""
    : indexed.length
      ? group("hit", "✓", "Pointed at the cheater", hit) + group("miss", "✗", "Pointed at innocents", miss)
      : `<div class="me-cf-empty" id="me-cf-empty">No exhibits this period. Not a speck of chalk dust.</div>`;
  const foot = show
    ? `<span id="me-cf-foot">Evidence, not proof${indexed.length ? ` · ${hit.length} of ${indexed.length} hit the cheater` : ""}.</span>`
    : "";
  return `<section class="card me-sec me-cf" id="me-cf" aria-labelledby="me-cf-h">
    <h2 class="me-h" id="me-cf-h"><span>📁 Case file</span><span class="me-aside">evidence ≠ proof</span></h2>
    <div class="me-cf-list" style="--g:${indexed.length ? 2 : 0};--n:${Math.max(1, indexed.length)}">${body}</div>
    <p class="me-cf-foot" style="--i:${k}">${foot}</p>
  </section>`;
}

/** Semester standings: rows land in the pre-match order with this match's
 *  deltas popping in (session beat), then slide to the new order with
 *  translateY (done beat). DOM order stays in seat order so morphing never
 *  moves a node mid-transition. */
const SEM_ROW = 40; // px — keep in sync with --me-sem-row in matchEnd.css

function semester(ctx: RenderCtx, b: Set<MatchEndBeat>): string {
  const { s, app } = ctx;
  const e = s.match!.end!;
  const delta = (id: string) => e.sessionDelta[id] ?? 0;
  const after = (id: string) => s.sessionBoard[id] ?? 0;
  const before = (id: string) => after(id) - delta(id);
  const settled = b.has("done");
  const value = settled ? after : before;
  const order = [...s.players].sort((a, c) => value(c.id) - value(a.id));
  const rk = compRanks(order.map((p) => value(p.id)));
  const pos = new Map(order.map((p, i) => [p.id, i]));
  const popOrder = new Map([...s.players].sort((a, c) => before(c.id) - before(a.id)).map((p, i) => [p.id, i]));
  const rows = b.has("session")
    ? s.players
        .map((p) => {
          const i = pos.get(p.id)!;
          const d = delta(p.id);
          return `<div class="me-sem-row${p.id === app.selfId ? " self" : ""}" id="me-sem-${p.id}" role="listitem" style="transform:translateY(${i * SEM_ROW}px)">
            <div class="me-sem-in">
              <span class="me-rank">${rk[i]}</span>
              <span class="av" aria-hidden="true">${p.avatar}</span>
              <span class="me-nm" title="${esc(p.name)}">${esc(p.name)}</span>
              <span class="delta me-delta ${d > 0 ? "pos" : d < 0 ? "neg" : "zero"}" style="--j:${popOrder.get(p.id)}">${d > 0 ? "+" : d < 0 ? "−" : "±"}${Math.abs(d)}</span>
              <span class="me-tot">${value(p.id)}</span>
            </div>
          </div>`;
        })
        .join("")
    : "";
  return `<section class="card me-sec me-sem" id="me-sem" aria-labelledby="me-sem-h">
    <h2 class="me-h" id="me-sem-h"><span>🎓 Semester standings</span><span class="me-aside">${s.matchNumber} period${s.matchNumber === 1 ? "" : "s"}</span></h2>
    <div class="me-sem-list" role="list" style="--n:${s.players.length}">${rows}</div>
  </section>`;
}

function dock(ctx: RenderCtx, b: Set<MatchEndBeat>): string {
  const { app } = ctx;
  const inner = !b.has("done")
    ? ""
    : app.isHost
      ? `<button class="btn" data-action="advance" id="me-advance">🏫 Back to homeroom</button>
         <div class="me-dock-row">
           <button class="btn secondary" data-action="downloadLog" id="me-log">⬇ Match log</button>
           <button class="btn secondary" data-action="endSession" id="me-endday">🔔 End the day</button>
         </div>`
      : `<p class="me-wait" id="me-wait" role="status">Waiting for the teacher…</p>`;
  return `<div class="me-dock${app.isHost ? " host" : ""}" id="me-dock">${inner}</div>`;
}

export const matchEnd: Screen = {
  beatKey: (ctx) => [...beats(ctx).b].join(","),
  render(ctx) {
    const { s } = ctx;
    const { v, tl, b } = beats(ctx);
    const drum = { at: tl.beats.drumroll, dur: tl.beats.unmask - tl.beats.drumroll };
    const siren = v === "graduated" ? `<div class="me-siren" aria-hidden="true"></div>` : "";
    // ≤24 particles: one burst with the banner, one with the unmask.
    const party =
      v === "caught"
        ? `<div class="me-confetti" aria-hidden="true">${confetti(0, 12, 120)}${b.has("unmask") ? confetti(12, 12, 150) : ""}</div>`
        : "";
    return `<section class="screen screen-matchEnd v-${v} ${[...b].map((x) => `b-${x}`).join(" ")}" aria-label="Period ${s.matchNumber} results">
      ${siren}${party}
      ${banner(v)}
      ${hero(ctx, v, b, drum)}
      ${reportCard(ctx, b)}
      ${caseFileRecap(ctx, b)}
      ${semester(ctx, b)}
      ${dock(ctx, b)}
    </section>`;
  },
};
