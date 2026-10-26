// 6. Vote (spec 07, 08 §4): a takeover. v0.23: a trial. The accused takes the
// stage (their face, the accuser's on its badge, "NO WAY YOU KNEW THAT!") and
// has the floor for a few seconds before any ballot can go in; then the
// candidates (the accused first, across both columns, then seat order) take
// picks, a compositor countdown drains, and a "handed in" strip shows WHO has
// voted (never for whom). A v0.22 vote (nobody named) keeps the raised hand.
// Nothing here reads app.secret — the cheater's vote screen is identical to
// everyone else's; "you have the floor" depends on your seat, never your role.
// Phone play: a tap only PICKS a classmate (a mis-tap is free to fix); the
// ballot goes in from the sticky dock, in thumb reach. A pick that is never
// handed in goes in by itself just before the vote closes (main.ts).
import type { PublicPlayer, PublicState } from "../../../shared/protocol";
import { av, esc, exhibitBadges, fmtTime, pointerChip, sessionTab, voteTopLine } from "./common";
import type { RenderCtx, Screen } from "./types";
import { face } from "../avatars";

/** Entrance beats, ms from the vote phase start. Local to this screen: the
 *  vote has no host-gated beats, so they don't belong in shared/choreo.ts. */
const AT = { avatar: 60, stamp: 140, sub: 440, clock: 500, grid: 600 } as const;
const CELL_STAGGER = 110; // --stagger-info: the seat order carries meaning
const URGENT_MS = 5000; // same urgency window as the question timer

/** ms from the vote phase start: ballots open (v0.23, after the accused's
 *  floor; at once in a v0.22 vote) and the vote closes. */
function windowOf(s: PublicState): { open: number; close: number } {
  const v = s.match?.vote;
  const open = v?.opensAt !== undefined ? Math.max(0, v.opensAt - s.phaseStartedAt) : 0;
  return { open, close: Math.max(open, (v?.deadline ?? s.phaseStartedAt) - s.phaseStartedAt) };
}

/** Reached beats at distinct moments only: two landing in one frame would
 *  read to the shell as a jump and settle (skip) the motion. */
function beats(ctx: RenderCtx): string[] {
  if (ctx.elapsed < 0) return []; // the beat lead: the gavel waits for the shared clock
  const { open, close } = windowOf(ctx.s);
  const trial = ctx.s.match?.vote?.opensAt !== undefined;
  const at: [string, number][] = [["in", 0], ...(trial ? ([["open", open]] as [string, number][]) : []), ["urgent", Math.max(open, close - URGENT_MS)], ["closed", close]];
  const seen = new Set<number>();
  const out: string[] = [];
  for (const [beat, t] of at) {
    if (ctx.elapsed < t || seen.has(t)) continue;
    seen.add(t);
    out.push(beat);
  }
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
    const { open: openMs, close: closeMs } = windowOf(s);
    const playerOf = (id: string) => s.players.find((p) => p.id === id);
    const accuser = playerOf(v.accuserId);
    // v0.23: the trial. Without an accused (a v0.22 save or tape): the old stage.
    const accused = v.accusedId && v.opensAt !== undefined ? playerOf(v.accusedId) : undefined;
    const floor = !!accused && !b.has("open");
    const self = playerOf(app.selfId);
    const iAccused = !!accused && app.selfId === v.accuserId;
    // The accuser's ballot went in with the accusation (no take-backs).
    const myVote = app.ui.myVote ?? (iAccused ? v.accusedId! : null);
    const voted = !!self?.votedCurrent || myVote !== null;
    const rights = !!self && !self.banished && self.votingRights;
    const canVote = rights && !voted && !closed && !floor;
    const sel = canVote ? app.ui.voteSel : null;
    const lastStrike = s.settings.strikes > 0 && m.wrongDetentions === s.settings.strikes - 1;
    const selName = sel ? esc(playerOf(sel)?.name ?? "???") : "";
    const accusedName = accused ? esc(accused.name) : "";
    const seated = s.players.filter((p) => !p.banished);
    // The accused first (across both columns), then seat order.
    const candidates = accused ? [accused, ...seated.filter((p) => p.id !== accused.id)] : seated;
    const eligible = s.players.filter((p) => !p.banished && p.votingRights);
    const inCount = eligible.filter((p) => p.votedCurrent).length;
    const cleared = new Set(m.cleared);

    // While the accused has the floor, each phone is told what it's for (by
    // seat: the accused, the accuser, everyone else).
    const floorLine = !floor || !self
      ? ""
      : self.id === accused!.id
        ? "🎤 You have the floor. Make your case!"
        : iAccused
          ? `🙋 Your ballot is in: ${accusedName}.`
          : `🎤 ${accusedName} has the floor… ballots open in <span data-count="${v.opensAt}"></span>`;
    const status = app.tv
      ? floor
        ? `📺 ${accusedName} has the floor.`
        : "📺 The class is voting."
      : !self
        ? "👀 Watching from the hallway."
        : self.banished
          ? "In detention: no vote this time."
          : !self.votingRights
            ? "You've lost your vote this match."
            : floor
              ? floorLine
              : iAccused
                ? `Your ballot: ${accusedName} (you accused them). No take-backs.`
                : myVote
                  ? `Handed in: ${esc(playerOf(myVote)?.name ?? "???")}. No take-backs.`
                  : self.votedCurrent
                    ? "Ballot handed in. No take-backs."
                    : closed
                      ? "⏰ Pencils down. Counting the ballots…"
                      : sel
                        ? `Picked ${selName}. Hand it in, or tap someone else.`
                        : "Tap a classmate, then hand in your ballot.";
    // The dock: the one button that sends the ballot, in thumb reach.
    const dockInner = canVote
      ? sel
        ? `<button class="btn vo-go" id="vo-go" data-action="handIn"><span aria-hidden="true">🗳️ </span>Hand in: <b>${selName}</b></button>`
        : `<button class="btn secondary vo-go" id="vo-go" disabled><span aria-hidden="true">👆 </span>Tap a classmate</button>`
      : `<p class="vo-dock-note" id="vo-dock-note"><span>${status}</span></p>`;

    const cell = (p: PublicPlayer, i: number) => {
      const picked = voted && myVote === p.id;
      const chosen = !picked && sel === p.id;
      const isClear = cleared.has(p.id);
      const isAccused = p.id === accused?.id;
      const pick = pickChip(s, p.id);
      const ex = exhibitBadges(s, p.id);
      const tags = `${p.id === v.accuserId ? `<span class="vo-hand-tag" title="Raised the hand">🙋</span>` : ""}${isAccused ? `<span class="vo-mic-tag" title="Has the floor">🎤</span>` : ""}${p.id === app.selfId ? `<span class="vo-you">YOU</span>` : ""}`;
      const aria = [`Pick ${esc(p.name)}${p.id === app.selfId ? " (you)" : ""}${isAccused ? " (accused)" : ""}.`, pick.aria, isClear ? "Cleared: proven innocent." : "", ex ? "Has exhibits." : ""].filter(Boolean).join(" ");
      // The circle lives OUTSIDE the button: the shell morphs with
      // ignoreActiveValue, which never updates a focused (just-tapped)
      // element's children — only its attributes.
      return `<div class="vo-wrap${isAccused ? " accused" : ""}${picked ? " picked" : chosen ? " sel" : ""}" id="vw-${p.id}" ${enter(AT.grid + i * CELL_STAGGER, elapsed)}>
        <button class="vo-cell${picked ? " picked" : chosen ? " sel" : ""}${isClear ? " cleared" : ""}" id="vc-${p.id}" data-action="vote" data-id="${p.id}"
          aria-label="${aria}" aria-pressed="${picked || chosen}" ${canVote ? "" : "disabled"}>
          ${av(p, "vo-av")}
          <span class="vo-nm" title="${esc(p.name)}">${esc(p.name)}</span>
          <span class="vo-tags">${tags}</span>
          <span class="vo-meta">${pick.html}${pointerChip(s, p.id)}${ex}</span>
          ${isClear ? `<span class="vo-clear-row"><span class="vo-cleared">CLEARED</span><span class="vo-proven">proven<br />innocent</span></span>` : ""}
        </button>
        ${picked ? CHALK_CIRCLE : ""}
      </div>`;
    };

    const slot = (p: PublicPlayer) =>
      `<span class="vo-slot${p.votedCurrent ? " in" : ""}" id="vs-${p.id}" title="${esc(p.name)}${p.votedCurrent ? " handed in" : " is still deciding"}">${
        p.votedCurrent ? `<span class="vo-in" id="vi-${p.id}" aria-hidden="true">${face(p.avatar)}</span>` : ""
      }</span>`;

    // The stage: the accused, named, with the accuser's face on the badge (v0.23).
    const stage = accused
      ? `<div class="vo-accuser trial" id="vo-accuser" ${enter(AT.stamp, elapsed)}>
      <span class="vo-bigav" id="vo-bigav" aria-hidden="true" ${enter(AT.avatar, elapsed)}>${face(accused.avatar)}${
        accuser ? `<span class="vo-by" id="vo-by" title="${esc(accuser.name)} accused">${face(accuser.avatar)}<span class="vo-by-hand">🙋</span></span>` : ""
      }</span>
      <div class="vo-stamp" id="vo-stamp" role="alert" ${enter(AT.stamp, elapsed)}>
        <span class="sr-only">${accuser ? `${esc(accuser.name)} accuses ` : ""}</span><span class="vo-stamp-name" title="${accusedName}">${accusedName}</span>
        <span class="vo-stamp-line">NO WAY YOU KNEW THAT!</span>
      </div>
    </div>`
      : `<div class="vo-accuser" id="vo-accuser" ${enter(AT.stamp, elapsed)}>
      <span class="vo-bigav" id="vo-bigav" aria-hidden="true" ${enter(AT.avatar, elapsed)}>${accuser ? face(accuser.avatar) : "🙋"}</span>
      <div class="vo-stamp" id="vo-stamp" role="alert" ${enter(AT.stamp, elapsed)}>
        <span class="vo-stamp-name" title="${esc(accuser?.name ?? "")}">🙋 ${esc(accuser?.name ?? "Someone")}</span>
        <span class="vo-stamp-line">raises a hand</span>
      </div>
    </div>`;
    const openSub = lastStrike ? "⚠ Last strike: wrong again = the cheater graduates" : "Who's the cheater? Most votes → detention.";
    // v0.23: the floor line and the ballot line share one box, so nothing
    // moves under a thumb when ballots open.
    const sub = accused
      ? `<p class="vo-sub trial" id="vo-sub" ${enter(AT.sub, elapsed)}>
          <span class="vo-sub-l floor" aria-hidden="${!floor}">🎤 ${accusedName} has the floor.</span>
          <span class="vo-sub-l open${lastStrike ? " last-strike" : ""}" aria-hidden="${floor}">${openSub}</span>
        </p>`
      : `<p class="vo-sub${lastStrike ? " last-strike" : ""}" id="vo-sub" ${enter(AT.sub, elapsed)}>${openSub}</p>`;
    // The countdown: to the ballots opening (the floor), then to the bell.
    const drain = floor
      ? `<div class="vo-drain floor" id="vo-drain-floor" ${enter(0, elapsed, `--dur:${openMs}ms`)}></div>`
      : `<div class="vo-drain" id="vo-drain" ${enter(openMs, elapsed, `--dur:${closeMs - openMs}ms`)}></div>`;
    const sr = floor && floorLine.includes("data-count") ? `🎤 ${accusedName} has the floor. Ballots open in a few seconds.` : status;

    const cls = ["screen", "screen-vote", ...[...b].map((x) => `b-${x}`), accused ? "trial" : "", floor ? "on-floor" : "", candidates.length <= 6 ? "roomy" : "", voted ? "has-voted" : "", sel ? "has-sel" : "", rights ? "" : "no-rights"]
      .filter(Boolean)
      .join(" ");
    return `<section class="${cls}">
    ${sessionTab(app, s)}
    <div class="vo-top">${voteTopLine(`Q${m.questionIdx + 1}/${m.questionCount}`, accused && accuser ? [accuser.name] : [])}</div>
    ${stage}
    ${sub}
    <div class="vo-clock" id="vo-clock" ${enter(AT.clock, elapsed)}>
      <div class="vo-track" aria-hidden="true">${drain}</div>
      <span class="vo-num" data-count="${floor ? v.opensAt : v.deadline}" role="timer" aria-label="${floor ? "Seconds until ballots open" : "Seconds left to vote"}"></span>
    </div>
    <div class="vo-cap" id="vo-cap" ${enter(AT.grid - 80, elapsed)}><span>Q${m.questionIdx + 1} answer · exhibits</span><span>${canVote ? "tap to pick" : ""}</span></div>
    <div class="vo-grid" role="group" aria-label="Candidates">
      ${candidates.map(cell).join("")}
    </div>
    ${candidates.some((p) => cleared.has(p.id)) ? `<p class="vo-legend">CLEARED = crossed the line with no siren. Still votable.</p>` : ""}
    <div class="vo-handin" id="vo-handin" role="group" aria-label="${inCount} of ${eligible.length} ballots handed in" ${enter(AT.grid + candidates.length * CELL_STAGGER, elapsed)}>
      <div class="vo-handin-head"><span>📥 Handed in</span><span class="vo-handin-n">${inCount}/${eligible.length}</span></div>
      <div class="vo-slots">${eligible.map(slot).join("")}</div>
    </div>
    <p class="sr-only" role="status">${sr}</p>
    <div class="vo-dock" id="vo-dock" ${enter(AT.grid + candidates.length * CELL_STAGGER, elapsed)}>${dockInner}</div>
    </section>`;
  },
};
