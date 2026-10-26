// 4. Question (spec 07, 08 §4). A quiz sheet handed out in class:
//   0      subject flashcard flips in (hd-spin-in), header + timer fade in
//   150    question text rises
//   250+50i options cascade (decorative stagger)
//   tap    press → "LOCKED IN" stamp on the pick → other options fade to 55%
//   …      "locked in" desks: each classmate's avatar pops in as they answer
//   −5000  URGENT: the chalk timer bar turns red, the number pulses each second
//   0      "✏️ PENCILS DOWN" stamps over the options (400ms before the reveal)
//
// The timer bar is a compositor animation (transform: scaleX) whose duration
// is the question timer and whose negative delay is the time already spent, so
// it is right on every phone and after a late join. Its inline style is frozen
// with data-keep-style so later morphs never retime it.
//
// PARITY: the cheater's screen differs ONLY by the "cheat-mark" class on the
// correct option (a geometry-free faint corner dot, see question.css). No other
// class, element, text length or animation depends on the secret.
import { actOf, esc, LETTERS, sessionTab, tierTicks } from "./common";
import type { RenderCtx, Screen } from "./types";
import { face } from "../avatars";

const URGENT_MS = 5000;

/** v0.26: the class moved the difficulty (everyone got the last one, or
 *  nobody did). Stamped on the subject card as the sheet lands. */
const shiftStamp = (shift: "up" | "down" | undefined, qk: string) =>
  shift
    ? `<span class="qz-shift ${shift}" id="qz-shift-${qk}" role="note" aria-label="${shift === "up" ? "Harder: everyone got the last one" : "Easier: nobody got the last one"}">${shift === "up" ? "▲ HARDER" : "▼ EASIER"}</span>`
    : "";
/** After this long into the question, the entrance has finished: later
 *  renders (and late joins) show the settled sheet with no entrance motion. */
const ENTRANCE_DONE_MS = 900;

interface QClock {
  total: number; // question timer (ms)
  left: number; // ms until the deadline (negative after it)
  spent: number; // ms of the timer already used
  urgent: boolean;
  pencils: boolean;
  secs: number; // the number on the countdown (ceil of seconds left)
}

function clockOf(ctx: RenderCtx): QClock {
  const q = ctx.s.match!.question!;
  const total = ctx.s.settings.questionTimerMs;
  // deadline = phaseStartedAt + timer (engine), so spent ≡ ctx.elapsed; using
  // the deadline keeps the bar and the number on exactly the same instant.
  const left = q.deadline - ctx.now;
  return {
    total,
    left,
    spent: Math.max(0, total - left),
    urgent: left <= URGENT_MS,
    pencils: left <= 0,
    secs: Math.max(0, Math.ceil(left / 1000)),
  };
}

/** Beat boundaries: each urgent second is its own beat (the number pulses on
 *  the exact frame its digit changes), then pencils down. Entry is beat-less,
 *  so a normal entry never counts as a multi-beat jump. */
function beats(c: QClock): string[] {
  const out: string[] = [];
  if (c.urgent) out.push(`u${c.secs}`);
  if (c.pencils) out.push("pencils");
  return out;
}

const attr = (s: string) => esc(s);

/** Reduced-motion timer: one chalk tally per second (5–30 of them) that fades
 *  out as its second runs out — opacity only, same instants as the bar. */
function tallies(c: QClock): string {
  const n = Math.max(5, Math.min(30, Math.round(c.total / 1000)));
  const step = c.total / n;
  let out = "";
  for (let i = 0; i < n; i++) {
    // Tally i (left → right) is visible while more than i steps remain.
    const at = c.total - i * step; // spent-ms when it goes out
    out += `<i class="qz-tally" data-keep-style style="--d:${Math.round(at - c.spent)}ms"></i>`;
  }
  return out;
}

export const question: Screen = {
  beatKey: (ctx) => beats(clockOf(ctx)).join(","),

  render(ctx) {
    const { app, s } = ctx;
    const m = s.match!;
    const q = m.question!;
    const c = clockOf(ctx);
    const qk = `${s.matchNumber}-${m.questionIdx}`; // fresh ids per question
    const self = s.players.find((p) => p.id === app.selfId);
    const myPick = app.ui.myPick;
    // Locked the instant this phone taps (before the host echoes it back).
    const locked = myPick !== null || !!self?.answeredCurrent;
    const watching = !self; // in the hallway: watching, not playing
    const closed = locked || c.pencils || watching;
    const cheatIdx = app.secret.correctIdx; // -1 for innocents
    const act = actOf(m.questionIdx);
    const answered = s.players.filter((p) => p.answeredCurrent || (p.id === app.selfId && locked));
    const total = s.players.filter((p) => p.connected || p.answeredCurrent).length;

    const rootCls = [
      "screen",
      "screen-question",
      ctx.elapsed > ENTRANCE_DONE_MS ? "is-entered" : "",
      locked ? "is-locked" : "",
      c.urgent ? "b-urgent" : "",
      c.pencils ? "b-pencils" : "",
    ]
      .filter(Boolean)
      .join(" ");

    const options = q.options
      .map((opt, i) => {
        const picked = locked && myPick === i;
        // cheat-mark is the ONLY secret-dependent token on this screen.
        const cls = ["opt", i === cheatIdx ? "cheat-mark" : "", picked ? "picked" : ""].filter(Boolean).join(" ");
        // NB: nothing inside the button may change after a tap — the shell's
        // morph skips the children of the focused element. Stamps therefore
        // live in the board grid (same cell as the option), not in the button.
        return `<button class="${cls}" id="qz-opt-${qk}-${i}" style="--i:${i};grid-row:${i + 1}" data-action="answer" data-idx="${i}" ${closed ? "disabled" : ""} aria-label="${LETTERS[i]}: ${attr(opt)}${picked ? " (locked in)" : ""}">
          <span class="qz-letter" aria-hidden="true">${LETTERS[i]}</span><span class="qz-opt-text">${esc(opt)}</span>
        </button>`;
      })
      .join("");
    const lockStamp =
      locked && myPick !== null
        ? `<span class="qz-stamp qz-lock-stamp" id="qz-lock-${qk}" style="grid-row:${myPick + 1}" aria-hidden="true">LOCKED IN</span>`
        : "";

    const desks = s.players
      .map((p) => {
        const isIn = p.answeredCurrent || (p.id === app.selfId && locked);
        const me = p.id === app.selfId;
        const label = `${p.name}${me ? " (you)" : ""}: ${isIn ? "locked in" : p.connected ? "still thinking" : "reconnecting"}`;
        return `<span class="qz-desk${me ? " me" : ""}${p.connected ? "" : " off"}" id="qz-desk-${qk}-${p.id}" role="listitem" title="${attr(label)}" aria-label="${attr(label)}">${
          isIn ? `<span class="qz-desk-av" id="qz-av-${qk}-${p.id}" aria-hidden="true">${face(p.avatar)}</span>` : ""
        }</span>`;
      })
      .join("");

    const lockLabel = c.pencils ? "Pencils down!" : app.tv ? "Locked in so far" : watching ? "👀 Watching from the hallway" : locked ? "Locked in. Waiting for the class…" : "Locked in";
    const status = c.pencils
      ? "Pencils down."
      : locked
        ? `Locked in${myPick !== null ? `: ${LETTERS[myPick]}, ${q.options[myPick]}` : ""}.`
        : c.urgent
          ? "Five seconds left."
          : "";

    return `<section class="${rootCls}">
    ${sessionTab(app, s)}
    <hd-qsheet class="qz" id="qz-${qk}">
      <header class="qz-head">
        <span class="qz-qn"><b>Q${m.questionIdx + 1}</b>/${m.questionCount}</span>
        <span class="qz-ticks" role="img" title="${q.tier}" aria-label="${q.tier} question">${tierTicks(q.tier)}</span>
        <span class="qz-act" title="${act.n} · ${act.name}"><span class="qz-act-n">${act.n} · </span>${act.name}</span>
      </header>

      <div class="qz-cardwrap">
        <div class="qz-card" id="qz-card-${qk}">
          <span class="qz-card-emoji" aria-hidden="true">${q.subjectEmoji}</span>
          <span class="qz-card-subject"><span class="qz-card-sub">Subject</span><span class="qz-card-name" title="${attr(q.subject)}">${esc(q.subject)}</span></span>
          <span class="qz-card-pts">${q.points}<small>pts</small></span>
        </div>
        ${shiftStamp(q.shift, qk)}
      </div>

      <div class="qz-timer" role="timer" aria-label="Seconds left">
        <div class="qz-track" aria-hidden="true">
          <div class="qz-fill" id="qz-fill-${qk}" data-keep-style style="--qt-dur:${c.total}ms;--qt-delay:${-Math.round(c.spent)}ms"><i class="qz-fill-hot"></i></div>
          <div class="qz-tallies">${tallies(c)}</div>
        </div>
        <span class="qz-count${c.urgent ? ` pulse-${c.secs % 2 ? "a" : "b"}` : ""}" data-count="${q.deadline}">${c.secs}</span>
      </div>

      <h2 class="qz-text${q.text.length > 90 ? " is-long" : ""}" id="qz-text-${qk}">${esc(q.text)}</h2>

      <div class="qz-board" role="group" aria-labelledby="qz-text-${qk}">
        ${options}
        ${lockStamp}
        ${c.pencils ? `<div class="qz-pencils" id="qz-pencils-${qk}" style="grid-row:1 / span ${q.options.length}" aria-hidden="true"><span class="qz-stamp qz-pencils-stamp">✏️ PENCILS DOWN</span></div>` : ""}
      </div>

      <div class="qz-lockin">
        <div class="qz-lock-row"><span class="qz-lock-label">${lockLabel}</span><span class="qz-lock-n">${answered.length}/${total}</span></div>
        <div class="qz-desks" role="list" aria-label="Classmates locked in">${desks}</div>
      </div>
      <p class="qz-sr" role="status">${esc(status)}</p>
    </hd-qsheet>
    </section>`;
  },
};
