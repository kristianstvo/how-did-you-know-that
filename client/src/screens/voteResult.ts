// 6b. Vote result (spec 07, 08 §4). Staged on voteResultTimeline (shared
// clock): sealed → ballots flip one by one in SEAT order ("Voter → Target",
// names revealed, Among Us style) while tally chips count up → verdict stamp
// → (innocent sent to detention) the graduation line slides left → the
// host's Continue. Pure function of public data: the cheater's phone plays
// the identical show.
import { reached, VOTE_FLIP_STAGGER, voteResultTimeline } from "../../../shared/choreo";
import type { PublicPlayer, PublicState } from "../../../shared/protocol";
import { av, esc, sessionTab } from "./common";
import type { RenderCtx, Screen } from "./types";

type Outcome = "caught" | "innocent" | "tie";

function plan(ctx: RenderCtx) {
  const { s, elapsed } = ctx;
  const vr = s.match!.voteResult!;
  const seat = new Map(s.players.map((p, i) => [p.id, i] as const));
  const voters = Object.keys(vr.votes).sort((a, b) => (seat.get(a) ?? 1e9) - (seat.get(b) ?? 1e9) || a.localeCompare(b));
  const dropped = vr.newThreshold !== null;
  const tl = voteResultTimeline(voters.length, dropped);
  const flipAt = (i: number) => tl.beats.flip + i * VOTE_FLIP_STAGGER;
  const flipped = voters.length ? Math.max(0, Math.min(voters.length, Math.floor((elapsed - tl.beats.flip) / VOTE_FLIP_STAGGER) + 1)) : 0;
  const b = reached(tl, elapsed);
  const outcome: Outcome = vr.tie || !vr.banishedId ? "tie" : vr.wasCheater ? "caught" : "innocent";
  return { vr, voters, dropped, tl, flipAt, flipped, b, outcome };
}

/** One key per distinct beat moment: each ballot flip is its own beat (so the
 *  tally text updates on the flip, frozen-frame exact), and "drop" only counts
 *  when the line really drops (otherwise it coincides with the verdict and
 *  would read as a two-beat jump, i.e. a settle). */
function beatList(p: ReturnType<typeof plan>): string[] {
  const keys = ["sealed"];
  for (let i = 0; i < p.flipped; i++) keys.push(i === 0 ? "flip" : `f${i}`);
  if (p.b.has("verdict")) keys.push("verdict");
  if (p.dropped && p.b.has("drop")) keys.push("drop");
  if (p.b.has("done")) keys.push("done");
  return keys;
}

/** Pin an entrance to the shared clock at insertion (see vote.ts). */
const enter = (atMs: number, elapsed: number, extra = "") =>
  `data-keep-style style="--d:${Math.round(atMs - elapsed)}ms${extra ? `;${extra}` : ""}"`;

const nm = (p: PublicPlayer | undefined) => (p ? `<span class="vr-nm" title="${esc(p.name)}">${esc(p.name)}</span>` : `<span class="vr-nm">???</span>`);

export const voteResult: Screen = {
  beatKey: (ctx) => beatList(plan(ctx)).join(","),
  render(ctx) {
    const { app, s, elapsed: el } = ctx;
    const m = s.match!;
    const P = plan(ctx);
    const { vr, voters, dropped, tl, flipAt, flipped, outcome } = P;
    const beats = beatList(P);
    const verdict = beats.includes("verdict");
    const done = beats.includes("done");
    const player = (id: string) => s.players.find((p) => p.id === id);
    const accuser = player(vr.accuserId);
    const banished = vr.banishedId ? player(vr.banishedId) : undefined;
    const vAt = tl.beats.verdict;

    // ---- Tallies: chips appear in first-landing order (never reflow) ----
    const order: string[] = [];
    const lands = new Map<string, number[]>();
    voters.forEach((v, i) => {
      const t = vr.votes[v];
      if (!lands.has(t)) {
        lands.set(t, []);
        order.push(t);
      }
      lands.get(t)!.push(flipAt(i));
    });
    const landed = new Map<string, number>();
    voters.slice(0, flipped).forEach((v) => landed.set(vr.votes[v], (landed.get(vr.votes[v]) ?? 0) + 1));
    const max = Math.max(0, ...Object.values(vr.tallies));
    const chipTag = (t: string) =>
      outcome === "caught" && t === vr.banishedId
        ? `<span class="vr-tag ok" id="vg-${t}" ${enter(vAt, el)}>CHEATER ✓</span>`
        : outcome === "innocent" && t === vr.banishedId
          ? `<span class="vr-tag bad" id="vg-${t}" ${enter(vAt, el)}>INNOCENT ✗</span>`
          : outcome === "tie" && vr.tallies[t] === max
            ? `<span class="vr-tag tie" id="vg-${t}" ${enter(vAt, el)}>TIE</span>`
            : "";
    const ticks = (t: string, c: number) => {
      const times = lands.get(t)!;
      return [0, 1]
        .map((g) => {
          let marks = "";
          for (let j = 1; j <= 5 && g * 5 + j <= c; j++) {
            const k = g * 5 + j;
            marks += `<i class="vr-tk${j === 5 ? " strike" : ""}" id="vk-${t}-${k}" ${enter(times[k - 1], el, `--j:${j - 1}`)}></i>`;
          }
          return `<span class="vr-tg">${marks}</span>`;
        })
        .join("");
    };
    const chips = order
      .filter((t) => landed.has(t))
      .map((t) => {
        const c = landed.get(t)!;
        const times = lands.get(t)!;
        const win = verdict && chipTag(t) !== "";
        return `<div class="vr-chip${win ? " win" : verdict ? " lose" : ""}" id="vt-${t}" ${enter(times[0], el)}>
          ${player(t) ? av(player(t)!, "vr-av") : ""}${nm(player(t))}
          <span class="vr-ticks" aria-hidden="true">${ticks(t, c)}</span>
          <span class="vr-count" id="vn-${t}-${c}" ${enter(times[c - 1], el)}><span class="vr-sr">: </span>${c}<span class="vr-sr"> vote${c === 1 ? "" : "s"}</span></span>
          ${verdict ? chipTag(t) : ""}
        </div>`;
      })
      .join("");
    const tallyRows = Math.ceil(order.length / 2);

    // ---- Ballots, seat order: sealed → flipped; ✓/✗ only where the truth is public ----
    const markFor = (t: string): "ok" | "bad" | "" =>
      outcome === "caught" ? (t === vr.banishedId ? "ok" : "bad") : outcome === "innocent" && t === vr.banishedId ? "bad" : "";
    const lines = voters
      .map((v, i) => {
        const t = vr.votes[v];
        const isF = i < flipped;
        const mk = verdict ? markFor(t) : "";
        const vp = player(v);
        const tp = player(t);
        return `<li class="vr-line${isF ? " flipped" : ""}${mk ? ` ${mk}` : ""}" id="vl-${v}">
          <span class="vr-who">${vp ? av(vp, "vr-av") : ""}${nm(vp)}${v === vr.accuserId ? `<span class="vr-hand" title="Raised the hand">🙋</span>` : ""}</span>
          <span class="vr-arrow" aria-hidden="true">→</span><span class="vr-sr">${isF ? "voted for" : "ballot sealed"}</span>
          <span class="vr-card">
            <span class="vr-back" aria-hidden="true">✉ sealed</span>
            ${isF ? `<span class="vr-face" id="vf-${v}" ${enter(flipAt(i) + 60, el)}>${tp ? av(tp, "vr-av") : ""}${nm(tp)}</span>` : ""}
          </span>
          <span class="vr-mark" aria-hidden="true">${mk ? `<span class="vr-mk" id="vm-${v}" ${enter(vAt + 250, el)}>${mk === "ok" ? "✓" : "✗"}</span>` : ""}</span>
        </li>`;
      })
      .join("");
    const abstained = s.players.filter((p) => !(p.id in vr.votes) && ((!p.banished && p.votingRights) || p.id === vr.banishedId));

    // ---- Header: sealed → the verdict stamp ----
    const n = voters.length;
    const sealedSub =
      n === 0 ? "Not one ballot handed in." : flipped === 0 ? `🗳️ ${n} sealed ballot${n === 1 ? "" : "s"}` : flipped < n ? `Counting… ${flipped} of ${n}` : `All ${n} counted.`;
    const wasCleared = !!banished && m.cleared.includes(banished.id);
    const strikes = s.settings.strikes;
    const struckOut = outcome === "innocent" && strikes > 0 && m.wrongDetentions >= strikes;
    const strikeTag = outcome === "innocent" && strikes > 0 ? ` · <span class="vr-strike">✗ strike ${m.wrongDetentions}${struckOut ? "" : ` of ${strikes}`}</span>` : "";
    const stamp =
      outcome === "caught"
        ? { l1: "CHEATER CAUGHT ✓", l2: `${banished ? av(banished, "vr-av") : ""}${nm(banished)}<span class="vr-l2t">→ detention</span>` }
        : outcome === "innocent"
          ? { l1: `DETENTION: ${nm(banished)}`, l2: `<span class="vr-l2t">Innocent!${strikeTag || (wasCleared ? " · was CLEARED" : "")}</span>` }
          : { l1: "TIE — NOBODY GOES", l2: `<span class="vr-l2t">${n === 0 ? "No votes, no detention." : `Tied at ${max} vote${max === 1 ? "" : "s"} each.`}</span>` };
    const verdictHtml = verdict
      ? `<div class="vr-verdict ${outcome}" id="vr-verdict" role="alert" ${enter(vAt, el)}>
          <div class="vr-stamp" id="vr-stamp" ${enter(vAt, el)}><span class="vr-l1">${stamp.l1}</span><span class="vr-l2">${stamp.l2}</span></div>
        </div>`
      : "";

    // ---- Consequence slot (same reserved box in every outcome) ----
    let after = "";
    if (verdict && struckOut) {
      after = `<p class="vr-note vr-strikeout" id="vr-note" ${enter(vAt + 300, el)}>${"✗".repeat(strikes)} Strike ${m.wrongDetentions}. Too many innocents in detention: the cheater graduates.</p>`;
    } else if (verdict && dropped) {
      const now = vr.newThreshold!;
      const drop = s.settings.thresholdDrop;
      const old = now + drop;
      const scores = s.players.map((p) => p.score);
      const lo = Math.max(0, Math.floor(Math.min(now, ...scores) / 200) * 200 - 200);
      const hi = Math.ceil(Math.max(old, ...scores) / 200) * 200 + 200;
      const pct = (x: number) => +(((x - lo) / (hi - lo)) * 100).toFixed(2);
      // Pins: avatars at their scores; near neighbours stack (2 rows max).
      const lastX: number[] = [];
      const pins = [...s.players]
        .sort((a, b) => a.score - b.score || (s.players.indexOf(a) - s.players.indexOf(b)))
        .map((p) => {
          const x = pct(p.score);
          let row = lastX.findIndex((lx) => x - lx >= 7);
          if (row === -1) row = lastX.length < 2 ? lastX.length : lastX.indexOf(Math.min(...lastX));
          lastX[row] = x;
          return `<span class="vr-pin${p.banished ? " out" : ""}" style="--x:${x}%;--row:${row}" title="${esc(p.name)}: ${p.score}">${p.avatar}</span>`;
        })
        .join("");
      after = `<div class="vr-gb" id="vr-gb" aria-label="Graduation line ${drop ? `drops ${drop}, from ${old} to ${now}` : `stays at ${now}`}" ${enter(vAt + 300, el)}>
        <div class="vr-gb-head"><span>🎓 Graduation line</span>
          <span class="vr-gb-val"><span class="vr-gb-old">${old}</span>${
            beats.includes("drop") && drop
              ? `<span class="vr-gb-minus" id="vr-gb-minus" ${enter(tl.beats.drop, el)}>−${drop}</span><span class="vr-gb-new" id="vr-gb-new" ${enter(tl.beats.drop + 450, el)}>→ ${now}</span>`
              : ""
          }</span></div>
        <div class="vr-gb-track" aria-hidden="true">
          <div class="vr-gb-rail"></div>
          ${pins}
          <span class="vr-gb-ghost" style="--x:${pct(old)}%"></span>
          <div class="vr-gb-clip"><div class="vr-gb-mover" style="--from:${pct(old)}%;--to:${pct(now)}%"><span class="vr-gb-line"></span><span class="vr-gb-cap">🎓</span></div></div>
          <div class="vr-gb-clip"><div class="vr-gb-mover rm-new" style="--from:${pct(now)}%;--to:${pct(now)}%"><span class="vr-gb-line"></span><span class="vr-gb-cap">🎓</span></div></div>
          ${beats.includes("drop") && drop ? `<span class="vr-gb-fly" id="vr-gb-fly" aria-hidden="true" ${enter(tl.beats.drop, el, `--x:${pct(old)}%`)}>−${drop}</span>` : ""}
        </div>
        <div class="vr-gb-scale"><span>${lo}</span><span>${hi}</span></div>
      </div>`;
    } else if (verdict) {
      const forCheater = voters.filter((v) => vr.votes[v] === vr.banishedId).length;
      const note =
        outcome === "caught"
          ? `🏫 Case closed: ${forCheater} of ${n} voted for the cheater. Report card next.`
          : `🔁 ${accuser ? esc(accuser.name) : "The accuser"}'s hand is spent. The line stays at ${m.threshold}.`;
      after = `<p class="vr-note" id="vr-note" ${enter(vAt + 300, el)}>${note}</p>`;
    }

    const cls = ["screen", "screen-voteResult", `out-${outcome}`, ...beats.map((x) => `b-${x}`), flipped === n && n > 0 ? "all-in" : "", n > 7 ? "dense" : ""]
      .filter(Boolean)
      .join(" ");
    return `<section class="${cls}">
    ${sessionTab(app, s)}
    <div class="vr-top">Q${m.questionIdx + 1}/${m.questionCount} · 🗳️ CLASS VOTE${accuser ? ` · 🙋 ${esc(accuser.name)}` : ""}</div>
    <div class="vr-head">
      <div class="vr-sealed" id="vr-sealed" ${enter(0, el)}>
        <div class="vr-sealed-t">The votes are in…</div>
        <div class="vr-sealed-s">${sealedSub}</div>
      </div>
      ${verdictHtml}
    </div>
    <div class="vr-after">${after}</div>
    ${n ? `<div class="vr-tally" style="--rows:${tallyRows}">${chips}</div>` : ""}
    ${n ? `<ol class="vr-lines" aria-label="Ballots, in seat order">${lines}</ol>` : `<p class="vr-empty">Nobody voted. Cowards.</p>`}
    ${abstained.length ? `<p class="vr-abstain">Didn't vote: ${abstained.map((p) => `${p.avatar} ${esc(p.name)}`).join(", ")}</p>` : ""}
    <div class="vr-dock">${
      done
        ? app.isHost
          ? `<button class="btn vr-continue" id="vr-continue" data-action="advance" ${enter(tl.beats.done, el)}>Continue ▸</button>`
          : `<p class="vr-wait" id="vr-wait" ${enter(tl.beats.done, el)}>Waiting for the teacher…</p>`
        : ""
    }</div>
    </section>`;
  },
};
