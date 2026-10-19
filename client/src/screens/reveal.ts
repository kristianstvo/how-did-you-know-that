// 5. Reveal — the game-show main stage (08-reveal-direction.md §3).
//
// Staged on the shared clock with shared/choreo.ts: every phone (the
// cheater's included) renders the same beats at the same moment, and nothing
// here reads app.secret. Layout: header · question · THE BOARD (4 option rows
// with avatar trays) · evidence slot · LAST BELL · GRADE BOOK · ACCUSE dock.
//
// Motion model. Every box is in the DOM from frame 0 (reserved, invisible);
// beats are state classes on the root <section> (b-slap, b-answer, …) and
// CSS TRANSITIONS on transform/opacity carry each element from its pre-beat
// state to its beat state. Transitions (unlike keyframe animations) never
// replay once the shell's .settle class is removed, so a jump (skip, late
// join, back from a vote) renders passed beats final and still. The few
// there-and-back effects (high-stakes shake, ACCUSE glow, PENCILS DOWN stamp,
// bell swing) are keyframes gated by "fx-<beat>" classes that only exist for a
// short window after their beat — a pure function of the shared clock.
import { REVEAL_TIMING, reached, revealTimeline, slapAt, type RevealBeat, type Timeline } from "../../../shared/choreo";
import { TIER_PLAN, type PublicPlayer, type RevealRow } from "../../../shared/protocol";
import { actOf, calloutCopy, CALLOUT_ICON, esc, exhibitBadges, fmtTime, lastBellLine, LETTERS, nameOf, pointerChip, pointSheet, sessionTab, speedOrder, tierTicks } from "./common";
import type { RenderCtx, Screen } from "./types";

function timeline(ctx: RenderCtx): Timeline<RevealBeat> {
  const r = ctx.s.match!.reveal!;
  return revealTimeline(r.stakes, r.rows.length, !!r.callout);
}

/** Elapsed is measured from the reveal's own start, so a skip or a return
 *  from a vote lands on the right beat. */
function revealElapsed(ctx: RenderCtx): number {
  return ctx.now - ctx.s.match!.reveal!.startedAt;
}

/** Reached beats that land at distinct moments. Without a callout the
 *  "evidence" beat coincides with "verdict"; listing both would look like a
 *  two-beat jump to the shell and settle (skip) the verdict's motion. */
function distinctReached(tl: Timeline<RevealBeat>, elapsed: number): RevealBeat[] {
  const seen = new Set<number>();
  const out: RevealBeat[] = [];
  for (const [beat, at] of Object.entries(tl.beats) as [RevealBeat, number][]) {
    if (elapsed < at || seen.has(at)) continue;
    seen.add(at);
    out.push(beat);
  }
  return out;
}

/** How long after its beat a there-and-back keyframe effect may still run.
 *  Outside the window the fx class is absent, so a late render shows the
 *  settled state instead of replaying the effect. */
const FX_WINDOW: Partial<Record<RevealBeat, number>> = { pencils: 900, answer: 800, evidence: 800, grade: 1500, accuse: 1400 };

/** Tray spacing (px): side by side up to 6, then a light overlap so 10
 *  avatars still fit one option row. Steps stay ≥17px so the centred
 *  rank/verdict badges never collide. */
const traySpacing = (n: number) => (n <= 6 ? 3 : n <= 8 ? -3 : -7);

/** Fixed grade-book scale for the whole match: every point the match can
 *  award. The graduation line therefore only moves when the line itself
 *  moves (a wrong detention), never because someone's score grew. */
function scaleMax(ctx: RenderCtx): number {
  const { s } = ctx;
  const m = s.match!;
  const possible = TIER_PLAN.slice(0, m.questionCount).reduce((sum, t) => sum + (s.settings.tierPoints[t] ?? 0), 0);
  return Math.max(possible, s.settings.threshold, m.threshold, ...s.players.map((p) => p.score), 1);
}

/** Decorative cascade step: --stagger-deco (50ms) but never more than 200ms
 *  end to end, so a 10-row cascade is done before the next beat. */
const decoStep = (n: number) => (n <= 1 ? 0 : Math.min(50, 200 / (n - 1)));

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const share = (x: number) => clamp01(x).toFixed(4);

export const reveal: Screen = {
  beatKey: (ctx) => distinctReached(timeline(ctx), revealElapsed(ctx)).join(","),
  render(ctx) {
    const { app, s } = ctx;
    const m = s.match!;
    const q = m.question!;
    const r = m.reveal!;
    const tl = timeline(ctx);
    const el = revealElapsed(ctx);
    const b = reached(tl, el);
    const fx = (Object.keys(FX_WINDOW) as RevealBeat[]).filter((beat) => b.has(beat) && el - tl.beats[beat] < FX_WINDOW[beat]!);
    const self = s.players.find((p) => p.id === app.selfId);
    const dense = r.rows.length > 6;

    // ---- who answered what, in speed order (public data only) ----
    const byId = new Map(s.players.map((p) => [p.id, p] as const));
    const rows = r.rows.filter((row) => byId.has(row.playerId));
    const rowOf = new Map(rows.map((row) => [row.playerId, row] as const));
    const order = speedOrder(s);
    const speedIdx = new Map(order.map((id, i) => [id, i] as const));
    const bySpeed = (a: RevealRow, b2: RevealRow) => (speedIdx.get(a.playerId) ?? 0) - (speedIdx.get(b2.playerId) ?? 0);
    const correct = rows.filter((row) => row.correct);
    const fastestCorrect = [...correct].sort(bySpeed)[0]?.playerId ?? null;
    const slap0 = tl.beats.slap;

    // ---- THE BOARD ----
    const tav = (row: RevealRow, j: number, n: number) => {
      const dj = Math.round(j * decoStep(n)); // ✓/✗ badge cascade within the tray
      const p = byId.get(row.playerId)!;
      const i = speedIdx.get(p.id) ?? 0;
      const delay = slapAt(r.stakes, i) - slap0; // lands at slap beat + i × stagger
      const none = row.pick === -1;
      const rank = !none && i < 3 ? `<span class="tav-rank">${i + 1}</span>` : "";
      const mark = none ? "" : `<span class="tav-mark ${row.correct ? "ok" : "no"}">${row.correct ? "✓" : "✗"}</span>`;
      const tip = `${esc(p.name)}${none ? " · no answer" : ` · ${fmtTime(row.timeMs)}`}`;
      return `<span class="tav${p.id === app.selfId ? " me" : ""}" id="tav-${p.id}" title="${tip}" style="--d:${delay}ms;--dj:${dj}ms;z-index:${20 - j}"><span class="av">${p.avatar}</span>${rank}${mark}</span>`;
    };
    const tray = (list: RevealRow[]) =>
      `<span class="tray" aria-hidden="true" style="--ov:${traySpacing(list.length)}px">${list.map((row, j) => tav(row, j, list.length)).join("")}</span>`;
    const pickers = (list: RevealRow[]) => list.map((row) => esc(byId.get(row.playerId)!.name)).join(", ");

    const optionRows = q.options
      .map((opt, k) => {
        const list = rows.filter((row) => row.pick === k).sort(bySpeed);
        const ok = k === r.correctIdx;
        const picks = !b.has("slap") ? "" : list.length ? `Picked by ${pickers(list)}.` : "Nobody picked it.";
        const sr = `${LETTERS[k]}: ${esc(opt)}${b.has("answer") ? (ok ? " — correct" : " — wrong") : ""}. ${picks}`;
        return `<div class="ob-row ${ok ? "is-correct" : "is-wrong"}" id="ob-${k}">
          <span class="ob-glyph" aria-hidden="true"><span class="ob-letter">${LETTERS[k]}</span><span class="ob-mark">${ok ? "✓" : "✗"}</span></span>
          <span class="ob-text" title="${esc(opt)}" aria-hidden="true">${esc(opt)}</span>
          ${tray(list)}
          <span class="sr-only">${sr}</span>
        </div>`;
      })
      .join("");
    const silent = rows.filter((row) => row.pick === -1).sort(bySpeed);
    // The chip itself appears with the first silent avatar's drop.
    const firstSilent = silent.length ? slapAt(r.stakes, speedIdx.get(silent[0].playerId) ?? 0) - slap0 : 0;
    const noneRow = silent.length
      ? `<div class="ob-none" id="ob-none"><span class="none-chip" style="--d:${firstSilent}ms"><span class="none-lbl" aria-hidden="true">🤐 no answer</span>${tray(silent)}<span class="sr-only">${b.has("slap") ? `No answer: ${pickers(silent)}.` : ""}</span></span></div>`
      : "";

    // ---- evidence slot ----
    const callout = r.callout ? calloutCopy(r.callout, s) : null;
    const exhibitNo = r.callout ? Math.max(0, m.caseFile.findIndex((e) => e.q === r.callout!.q && e.kind === r.callout!.kind)) : 0;
    let classNote = "";
    if (!callout) {
      const total = rows.length;
      const head = correct.length === total ? "Everyone got it." : correct.length === 0 ? "Nobody got it." : `${correct.length} of ${total} got it.`;
      const fast = fastestCorrect ? ` <span class="ev-fast">⚡ Fastest: ${nameOf(s, fastestCorrect)} ${fmtTime(rowOf.get(fastestCorrect)!.timeMs)}</span>` : "";
      classNote = `${head}${fast}`;
    }
    // First period only, Q1–Q3 (Act I: easy questions rarely carry evidence).
    // Public data only, so every phone shows the same note at the same beat.
    const k0 = s.settings.strikes;
    const strikeRule = k0 > 0 ? `${k0 === 1 ? "One wrong detention" : `${k0 === 2 ? "Two" : k0} wrong detentions`} and the cheater graduates.` : "A wrong detention lowers the cheater's line.";
    const TEACHER_NOTES = [
      "The board shows every answer <b>and its time</b>. Right and fast on a hard one? Suspicious.",
      "Suspect someone? Tap <b>👉</b> to point at them. It's free, and the whole class sees it.",
      `<b>🙋 ACCUSE</b> spends your one accusation on a class vote. ${strikeRule}`,
    ];
    const teach = !callout && s.matchNumber === 1 ? TEACHER_NOTES[m.questionIdx] : undefined;
    const evidence = callout
      ? `<div class="ev-slot has-card" id="ev-slot">
          <span class="ev-ph" aria-hidden="true">📁 case file</span>
          <div class="ev-card" id="ev-card" aria-hidden="${b.has("evidence") ? "false" : "true"}">
            <span class="ev-tag">EXHIBIT ${String.fromCharCode(65 + (exhibitNo % 26))}</span>
            <span class="ev-icon" aria-hidden="true">${callout.icon}</span>
            <div class="ev-body">
              <b class="ev-title">${esc(callout.title)}</b>
              <p class="ev-line">${callout.line}</p>
              ${callout.ask ? `<p class="ev-ask">${esc(callout.ask)}</p>` : ""}
            </div>
          </div>
        </div>
        <p class="ev-foot" id="ev-foot">Evidence, not proof.</p>`
      : `<div class="ev-slot has-note${teach ? " has-teach" : ""}" id="ev-slot"><p class="ev-note" id="ev-note" aria-hidden="${b.has("grade") ? "false" : "true"}">📝 ${classNote}</p>${
          teach ? `<p class="ev-teach" id="ev-teach-${m.questionIdx}" aria-hidden="${b.has("grade") ? "false" : "true"}"><span class="ev-teach-h">🍎 Teacher's note</span><span class="ev-teach-t">${teach}</span></p>` : ""
        }</div>`;

    // ---- LAST BELL ----
    const bellLine = r.lastBell.length ? lastBellLine(s, r.lastBell) : "";
    const bellRest = bellLine.replace(/^🔔 LAST BELL — /, "");
    const lastBell = bellLine
      ? `<div class="lb-slot" id="lb-slot"><div class="lastbell" id="lastbell" aria-hidden="${b.has("grade") ? "false" : "true"}"><span class="lb-bell" aria-hidden="true">🔔</span><span class="lb-text"><b>LAST BELL</b> ${bellRest === bellLine ? bellLine : `— ${bellRest}`}</span></div></div>`
      : "";

    // ---- GRADE BOOK ----
    const players = s.players.filter((p) => rowOf.has(p.id));
    const joinIdx = new Map(s.players.map((p, i) => [p.id, i] as const));
    const prevScore = (p: PublicPlayer) => p.score - (rowOf.get(p.id)?.pointsGained ?? 0);
    const prevOrder = [...players].sort((a, c) => prevScore(c) - prevScore(a) || joinIdx.get(a.id)! - joinIdx.get(c.id)!);
    const prevRank = new Map(prevOrder.map((p, i) => [p.id, i] as const));
    const newOrder = [...players].sort((a, c) => c.score - a.score || prevRank.get(a.id)! - prevRank.get(c.id)!);
    const newRank = new Map(newOrder.map((p, i) => [p.id, i] as const));
    const rowH = dense ? 32 : 34;
    const max = scaleMax(ctx);
    const cleared = new Set(m.cleared);
    const freshExhibit = r.callout && r.callout.kind !== "cleared" && r.callout.kind !== "stumper" ? r.callout : null;

    const gbRows = players
      .map((p) => {
        const row = rowOf.get(p.id)!;
        const p0 = prevScore(p);
        const y0 = prevRank.get(p.id)! * rowH;
        const y1 = newRank.get(p.id)! * rowH;
        const none = row.pick === -1;
        const time = none ? "—" : `${p.id === fastestCorrect ? "⚡" : ""}${fmtTime(row.timeMs)}`;
        const pts = row.pointsGained > 0 ? `+${row.pointsGained}` : "+0";
        const newEx = freshExhibit && freshExhibit.subjectIds.includes(p.id) ? `<span class="exhibit ex-new" title="Q${freshExhibit.q + 1}">${CALLOUT_ICON[freshExhibit.kind] ?? "🔎"}</span>` : "";
        const isCleared = cleared.has(p.id);
        const clearedNow = isCleared && p0 < m.threshold && p.score >= m.threshold;
        const stamps =
          isCleared || p.banished
            ? `<span class="gb-stamps${isCleared && p.banished ? " two" : ""}">${isCleared ? `<span class="gb-stamp cleared${clearedNow ? " now" : ""}">CLEARED</span>` : ""}${p.banished ? `<span class="gb-stamp detention">DETENTION</span>` : ""}</span>`
            : "";
        const status = p.banished ? ", in detention" : isCleared ? ", cleared" : "";
        const cls = ["gb-row", p.id === app.selfId ? "me" : "", p.banished ? "banished" : "", !p.connected && !p.isBot ? "off" : "", y0 !== y1 ? "moved" : ""].filter(Boolean).join(" ");
        return `<div class="${cls}" id="gb-${p.id}" title="${esc(p.name)}${!p.connected && !p.isBot ? " (reconnecting…)" : ""}"
            style="--y0:${y0}px;--y1:${y1}px;--s0:${share(p0 / max)};--s1:${share(p.score / max)};--dr:${Math.round(prevRank.get(p.id)! * decoStep(players.length))}ms">
          <span class="av" aria-hidden="true">${p.avatar}</span>
          <span class="gb-name"><span class="gb-nm">${esc(p.name)}</span>${exhibitBadges(s, p.id, m.questionIdx - 1)}${newEx}${pointerChip(s, p.id)}</span>
          <span class="gb-time${p.id === fastestCorrect ? " fast" : ""}">${time}</span>
          <span class="gb-pts${row.pointsGained > 0 ? " pos" : ""}">${pts}</span>
          <span class="gb-bar" aria-hidden="true"><span class="gb-fill now"></span><span class="gb-fill prev"></span>${stamps}</span>
          <span class="gb-score${p0 === p.score ? " same" : ""}" aria-hidden="true"><span class="sc0">${p0}</span><span class="sc1">${p.score}</span></span>
          <span class="sr-only">${esc(p.name)}: ${b.has("grade") ? p.score : p0} points${b.has("verdict") ? `, ${none ? "no answer" : `${row.correct ? "right" : "wrong"} in ${fmtTime(row.timeMs)}`}, ${pts}` : ""}${status}.</span>
        </div>`;
      })
      .join("");

    // ---- Strikes: one chalk box per allowed wrong detention, ✗ when used ----
    const k = s.settings.strikes;
    const w = m.wrongDetentions;
    const strikeBoxes =
      k > 0
        ? `<span class="gb-strikes" role="img" aria-label="Wrong detentions: ${w} of ${k}" title="${w} of ${k} strikes. At ${k}, the cheater graduates">${Array.from({ length: k }, (_, i) => `<i class="${i < w ? "used" : ""}">${i < w ? "✗" : ""}</i>`).join("")}</span>`
        : "";

    // ---- 👉 Point (v0.5): free and public; opens the sheet ----
    const myPtr = self?.pointingAt ? s.players.find((p) => p.id === self.pointingAt) : undefined;
    const pointBtn = `<button class="btn secondary rv-point${myPtr ? " on" : ""}" id="rv-point" data-action="pointSheet" aria-haspopup="dialog" aria-expanded="${app.ui.pointOpen}" ${self ? "" : "disabled"}
        aria-label="${myPtr ? `Pointing at ${esc(myPtr.name)}. Change` : "Point at a suspect"}"><span aria-hidden="true">👉${myPtr ? `<span class="rv-point-av">${myPtr.avatar}</span>` : ""}</span></button>`;

    // ---- ACCUSE dock ----
    const armed = b.has("accuse");
    const blocked = !self ? "Watching" : self.banished ? "In detention" : self.tokenUsed ? "Accusation used ✋" : !self.votingRights ? "No accusing" : "";
    const canAccuse = armed && !blocked;
    const confirm = canAccuse && app.ui.accuseConfirm;
    const accState = blocked ? "off" : confirm ? "confirm" : armed ? "go" : "wait";
    const accLabel = { off: blocked, confirm: "Use your only accusation? Tap again to confirm.", go: "🙋 ACCUSE", wait: "Watch the board…" }[accState];
    const accTitle = self?.banished ? "You're in detention — no accusing" : self?.tokenUsed ? "You already used your accusation" : !armed ? "Opens when the board is graded" : "";
    const lastQ = m.questionIdx + 1 >= m.questionCount;
    const hostBtn = app.isHost
      ? armed
        ? `<button class="btn secondary rv-host" id="rv-host" data-action="advance" data-min-next="${r.minNextAt}" ${ctx.now < r.minNextAt ? "disabled" : ""}>${lastQ ? "Final bell 🔔" : "Next question"}</button>`
        : `<button class="btn secondary rv-host" id="rv-host" data-action="skipShow" data-min-next="0">Skip ⏩</button>`
      : "";

    // ---- screen-reader narration: one span per beat, appended as beats land
    // (polite status region; the LAST BELL goes to an alert region) ----
    const said: string[] = ["Pencils down."];
    if (b.has("answer")) said.push(`Answer: ${LETTERS[r.correctIdx]}, ${esc(q.options[r.correctIdx])}. ${correct.length} of ${rows.length} got it.`);
    if (callout && b.has("evidence")) said.push(`Exhibit: ${esc(callout.title)}. ${callout.line} ${esc(callout.ask)}`);
    if (!callout && b.has("grade")) said.push(classNote.replace(/<[^>]+>/g, ""));
    if (teach && b.has("grade")) said.push(`Teacher's note: ${teach.replace(/<[^>]+>/g, "")}`);
    if (armed && canAccuse) said.push("Accusations are open.");
    const narration = said.map((x, i) => `<span id="rv-say-${i}">${x} </span>`).join("");
    const alert = bellLine && b.has("grade") ? bellLine : "";

    const act = actOf(m.questionIdx);
    const hold = REVEAL_TIMING[r.stakes].drumroll;
    const cls = [
      "screen",
      "screen-reveal",
      `stakes-${r.stakes}`,
      dense ? "dense" : "",
      ...[...b].map((x) => `b-${x}`),
      ...fx.map((x) => `fx-${x}`),
      b.has("drumroll") && !b.has("answer") ? "drumming" : "",
    ]
      .filter(Boolean)
      .join(" ");

    return `<section class="${cls}" style="--hold:${hold}ms;--rowh:${rowH}px" aria-label="Reveal, question ${m.questionIdx + 1}">
    ${sessionTab(app, s)}
    <header class="rv-head">
      <div class="rv-h1"><span class="rv-q">Q${m.questionIdx + 1}/${m.questionCount}</span><span class="rv-subj">${q.subjectEmoji} ${esc(q.subject)}</span></div>
      <div class="rv-h2"><span class="rv-ticks" role="img" title="${q.tier} · ${q.points} pts" aria-label="${q.tier} question, ${q.points} points">${tierTicks(q.tier)}</span><span class="chip rv-act">${act.n} · ${act.name}</span>${s.offlineQuestions ? `<span class="chip offline">offline questions</span>` : ""}</div>
    </header>
    <p class="rv-qtext" title="${esc(q.text)}">${esc(q.text)}</p>

    <div class="board" id="board">
      ${optionRows}
      ${noneRow}
      <div class="board-fx" aria-hidden="true"><span class="shimmer"></span></div>
      <div class="pd-wrap" aria-hidden="true"><span class="pd-stamp">✏️ PENCILS DOWN</span></div>
      <span class="chalk-ul" aria-hidden="true"></span>
    </div>

    ${evidence}
    ${lastBell}

    <div class="gb" id="gb" role="group" aria-label="Grade book">
      <div class="gb-head"><span class="gb-title">📋 Grade book</span>${strikeBoxes}</div>
      <div class="gb-rows" style="height:${players.length * rowH}px">
        ${gbRows}
        <div class="gb-line" aria-hidden="true" style="--line:${share(m.threshold / max)}"><span class="gb-line-lbl">🎓 line ${m.threshold}</span></div>
      </div>
    </div>

    <p class="sr-only" role="status" aria-live="polite" aria-atomic="false">${narration}</p>
    <p class="sr-only" role="alert">${alert}</p>

    <div class="rv-dock${app.isHost ? " host" : ""}">
      ${pointBtn}
      <button class="btn accuse st-${accState}" id="rv-accuse" data-action="accuse" ${canAccuse ? "" : "disabled"} aria-label="${esc(accLabel)}" ${accTitle ? `title="${esc(accTitle)}"` : ""}>
        <span class="ac-bg go"></span><span class="ac-bg confirm"></span><span class="ac-glow"></span>
        <span class="ac-l wait" aria-hidden="true">Watch the board…</span>
        <span class="ac-l go" aria-hidden="true">🙋 ACCUSE</span>
        <span class="ac-l confirm" aria-hidden="true">Sure? Tap again</span>
        <span class="ac-l off" aria-hidden="true">${esc(blocked || "—")}</span>
      </button>
      ${hostBtn}
    </div>
    ${pointSheet(app, s)}
    </section>`;
  },
};
