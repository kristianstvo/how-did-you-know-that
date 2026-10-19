// 6. Vote (spec 07, 08 §4): a takeover. The accuser's hand goes up (stamp),
// the candidates cascade in seat order, a compositor countdown drains, and a
// "handed in" strip shows WHO has voted (never for whom). Nothing here reads
// app.secret — the cheater's vote screen is identical to everyone else's.
import type { PublicPlayer, PublicState } from "../../../shared/protocol";
import { av, esc, exhibitBadges, fmtTime, sessionTab } from "./common";
import type { RenderCtx, Screen } from "./types";

/** Entrance beats, ms from the vote phase start. Local to this screen: the
 *  vote has no host-gated beats, so they don't belong in shared/choreo.ts. */
const AT = { avatar: 60, stamp: 140, sub: 440, clock: 500, grid: 600 } as const;
const CELL_STAGGER = 110; // --stagger-info: the seat order carries meaning
const URGENT_MS = 5000; // same urgency window as the question timer

const windowMs = (s: PublicState) => Math.max(0, (s.match?.vote?.deadline ?? s.phaseStartedAt) - s.phaseStartedAt);

function beats(ctx: RenderCtx): string[] {
  const w = windowMs(ctx.s);
  const out = ["in"];
  if (ctx.elapsed >= w - URGENT_MS) out.push("urgent");
  if (ctx.elapsed >= w) out.push("closed");
  return out;
}

/** Pin an entrance to the shared clock at insertion: the delay is measured
 *  from THIS render's elapsed, so a late join (or a settle) lands already
 *  finished, and later renders never re-time it (data-keep-style). */
const enter = (atMs: number, elapsed: number, extra = "") =>
  `data-keep-style style="--d:${Math.round(atMs - elapsed)}ms${extra ? `;${extra}` : ""}"`;

/** The candidate's answer on the question being discussed (✓/✗ + time). */
function pickChip(s: PublicState, id: string): { html: string; aria: string } {
  const qn = (s.match?.questionIdx ?? 0) + 1;
  const r = s.match?.reveal?.rows.find((x) => x.playerId === id);
  if (!r) return { html: `<span class="vo-pick none">—</span>`, aria: "" };
  if (r.pick === -1) return { html: `<span class="vo-pick none" title="Q${qn}: no answer">🤐 none</span>`, aria: `Q${qn}: no answer.` };
  const t = fmtTime(r.timeMs);
  return r.correct
    ? { html: `<span class="vo-pick ok" title="Q${qn}: right in ${t}">✓ ${t}</span>`, aria: `Q${qn}: right in ${t}.` }
    : { html: `<span class="vo-pick bad" title="Q${qn}: wrong in ${t}">✗ ${t}</span>`, aria: `Q${qn}: wrong in ${t}.` };
}

const CHALK_CIRCLE = `<svg class="vo-circle" viewBox="0 0 100 60" preserveAspectRatio="none" aria-hidden="true"><path d="M54 4 C82 3 98 15 97 31 C96 49 73 57 48 57 C21 57 3 47 3 30 C3 14 23 5 47 5 C60 4 70 6 78 9"/></svg>`;

export const vote: Screen = {
  beatKey: (ctx) => beats(ctx).join(","),
  render(ctx) {
    const { app, s, elapsed } = ctx;
    const m = s.match!;
    const v = m.vote!;
    const b = new Set(beats(ctx));
    const closed = b.has("closed");
    const playerOf = (id: string) => s.players.find((p) => p.id === id);
    const accuser = playerOf(v.accuserId);
    const self = playerOf(app.selfId);
    const myVote = app.ui.myVote;
    const voted = !!self?.votedCurrent || myVote !== null;
    const rights = !!self && !self.banished && self.votingRights;
    const canVote = rights && !voted && !closed;
    const candidates = s.players.filter((p) => !p.banished);
    const eligible = s.players.filter((p) => !p.banished && p.votingRights);
    const inCount = eligible.filter((p) => p.votedCurrent).length;
    const cleared = new Set(m.cleared);

    const status = !self
      ? ""
      : self.banished
        ? "You're in detention — no vote this time. Watch the ballots come in."
        : !self.votingRights
          ? "You've lost your vote this match. Watch the ballots come in."
          : myVote
            ? `You voted for ${esc(playerOf(myVote)?.name ?? "???")}. No take-backs.`
            : self.votedCurrent
              ? "Ballot handed in. No take-backs."
              : closed
                ? "⏰ Pencils down — counting the ballots…"
                : "Tap a classmate to vote. No take-backs.";

    const cell = (p: PublicPlayer, i: number) => {
      const picked = voted && myVote === p.id;
      const isClear = cleared.has(p.id);
      const pick = pickChip(s, p.id);
      const ex = exhibitBadges(s, p.id);
      const tags = `${p.id === v.accuserId ? `<span class="vo-hand-tag" title="Raised the hand">🙋</span>` : ""}${p.id === app.selfId ? `<span class="vo-you">YOU</span>` : ""}`;
      const aria = [`Vote for ${esc(p.name)}${p.id === app.selfId ? " (you)" : ""}.`, pick.aria, isClear ? "Cleared: proven innocent." : "", ex ? "Has exhibits." : ""].filter(Boolean).join(" ");
      // The circle lives OUTSIDE the button: the shell morphs with
      // ignoreActiveValue, which never updates a focused (just-tapped)
      // element's children — only its attributes.
      return `<div class="vo-wrap${picked ? " picked" : ""}" id="vw-${p.id}" ${enter(AT.grid + i * CELL_STAGGER, elapsed)}>
        <button class="vo-cell${picked ? " picked" : ""}${isClear ? " cleared" : ""}" id="vc-${p.id}" data-action="vote" data-id="${p.id}"
          aria-label="${aria}" aria-pressed="${picked}" ${canVote ? "" : "disabled"}>
          ${av(p, "vo-av")}
          <span class="vo-nm" title="${esc(p.name)}">${esc(p.name)}</span>
          <span class="vo-tags">${tags}</span>
          <span class="vo-meta">${pick.html}${ex}</span>
          ${isClear ? `<span class="vo-clear-row"><span class="vo-cleared">CLEARED</span><span class="vo-proven">proven<br />innocent</span></span>` : ""}
        </button>
        ${picked ? CHALK_CIRCLE : ""}
      </div>`;
    };

    const slot = (p: PublicPlayer) =>
      `<span class="vo-slot${p.votedCurrent ? " in" : ""}" id="vs-${p.id}" title="${esc(p.name)}${p.votedCurrent ? " handed in" : " is still deciding"}">${
        p.votedCurrent ? `<span class="vo-in" id="vi-${p.id}" aria-hidden="true">${p.avatar}</span>` : ""
      }</span>`;

    const cls = ["screen", "screen-vote", ...[...b].map((x) => `b-${x}`), candidates.length <= 6 ? "roomy" : "", voted ? "has-voted" : "", rights ? "" : "no-rights"]
      .filter(Boolean)
      .join(" ");
    return `<section class="${cls}">
    ${sessionTab(app, s)}
    <div class="vo-top">Q${m.questionIdx + 1}/${m.questionCount} · 🗳️ CLASS VOTE</div>
    <div class="vo-accuser" id="vo-accuser" ${enter(AT.stamp, elapsed)}>
      <span class="vo-bigav" id="vo-bigav" aria-hidden="true" ${enter(AT.avatar, elapsed)}>${accuser?.avatar ?? "🙋"}</span>
      <div class="vo-stamp" id="vo-stamp" role="alert" ${enter(AT.stamp, elapsed)}>
        <span class="vo-stamp-name" title="${esc(accuser?.name ?? "")}">🙋 ${esc(accuser?.name ?? "Someone")}</span>
        <span class="vo-stamp-line">raises a hand</span>
      </div>
    </div>
    <p class="vo-sub" id="vo-sub" ${enter(AT.sub, elapsed)}>Who's the cheater? Plurality goes to detention.</p>
    <div class="vo-clock" id="vo-clock" ${enter(AT.clock, elapsed)}>
      <div class="vo-track" aria-hidden="true"><div class="vo-drain" id="vo-drain" ${enter(0, elapsed, `--dur:${windowMs(s)}ms`)}></div></div>
      <span class="vo-num" data-count="${v.deadline}" role="timer" aria-label="Seconds left to vote"></span>
    </div>
    <div class="vo-cap" id="vo-cap" ${enter(AT.grid - 80, elapsed)}><span>Q${m.questionIdx + 1} answer · exhibits</span><span>${canVote ? "tap to vote" : ""}</span></div>
    <div class="vo-grid" role="group" aria-label="Candidates">
      ${candidates.map(cell).join("")}
    </div>
    ${candidates.some((p) => cleared.has(p.id)) ? `<p class="vo-legend">CLEARED = crossed the line with no siren. Still votable.</p>` : ""}
    <div class="vo-handin" id="vo-handin" role="group" aria-label="${inCount} of ${eligible.length} ballots handed in" ${enter(AT.grid + candidates.length * CELL_STAGGER, elapsed)}>
      <div class="vo-handin-head"><span>📥 Handed in</span><span class="vo-handin-n">${inCount}/${eligible.length}</span></div>
      <div class="vo-slots">${eligible.map(slot).join("")}</div>
    </div>
    <p class="vo-status" id="vo-status" role="status" ${enter(AT.grid + candidates.length * CELL_STAGGER, elapsed)}>${status}</p>
    </section>`;
  },
};
