// 1. Home / Join (spec 07; motion: 08-reveal-direction.md §4).
// v0.21: two steps. Step 1 is you: your name on the "HELLO my name is"
// sticker and your student from the class photo. Step 2 is where to: join a
// class by its code (on top), start one under it, or practice with bots
// (v0.22: stacked, not side by side). An invite link
// (#/join/CODE) needs no step 2: step 1's button joins that class.
// Beats (all on insertion; the shell morphs, so nothing replays per keystroke):
//   title wobble-in at 0 · tagline 150 · cards rise with the 50ms deco
//   stagger from 200 · footer 400. Next slides the page on; Change slides it back.
// You write your name straight onto the sticker (the input IS the sticker's
// name line; the focused input is never clobbered by a re-render) next to your
// student, who pops on every pick. Long names shrink the marker as they are
// typed (data-size, set live below).
// Errors shake (hd-shake) — and shake again on every tap that repeats the
// same error.
import { AVATARS } from "../../../shared/protocol";
import { face, STUDENTS } from "../avatars";
import { loadRecord } from "../record";
import { esc } from "./common";
import type { Screen } from "./types";

/** Short stable key for ids that must change when their content changes, so
 *  the morph inserts a fresh element (and its entrance animation replays). */
const keyOf = (str: string) => {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
};

/** Marker size on the sticker, so long names still fit the fixed-height tag. */
const tagSize = (name: string) => {
  const n = [...name].length;
  return n > 15 ? "xs" : n > 10 ? "sm" : "";
};

// The morph leaves a focused input alone, so size the marker as it's typed.
if (typeof document !== "undefined") {
  document.addEventListener(
    "input",
    (ev) => {
      const el = ev.target as HTMLInputElement | null;
      if (el?.id === "playerName") el.dataset.size = tagSize(el.value.trim());
    },
    true,
  );
}

/** Your report card (v0.12): this phone's record across every day played. */
function reportCard(): string {
  const r = loadRecord();
  if (!r.periods) return "";
  const best = Object.entries(r.awards)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([t, n]) => `${esc(t)}${n > 1 ? ` ×${n}` : ""}`)
    .join(" · ");
  const cell = (n: number, label: string) => `<div class="hm-rec-cell"><b>${n}</b><small>${label}</small></div>`;
  return `<details class="card hm-record" id="hm-record">
    <summary><span>📒 Your record</span><span class="hm-rec-sum">${r.periods} period${r.periods === 1 ? "" : "s"} · ${r.wins} win${r.wins === 1 ? "" : "s"}</span><span class="lb-chev" aria-hidden="true">▾</span></summary>
    <div class="hm-rec-grid">
      ${cell(r.cheater, r.cheater === 1 ? "time the cheater" : "times the cheater")}
      ${cell(r.cheaterWins, "got away")}
      ${cell(r.caught, r.caught === 1 ? "cheater caught" : "cheaters caught")}
      ${cell(r.detentions, "wrongly detained")}
    </div>
    ${best ? `<p class="hm-rec-awards">🏅 ${best}</p>` : ""}
    <p class="hm-rec-note">Kept on this phone only.</p>
  </details>`;
}

const nick = (avatar: string) => STUDENTS[avatar]?.title ?? "";

const notices = (closedReason: string | null, resuming: string | undefined) =>
  `${closedReason ? `<div class="warn hm-closed" id="hm-closed" role="status">🚪 ${esc(closedReason)}</div>` : ""}${
    resuming ? `<div class="warn hm-closed hm-resuming" id="hm-resuming" role="status">📡 Taking classroom ${esc(resuming)} back…</div>` : ""
  }`;

const errorLine = (error: string | null) => (error ? `<div class="err hm-err" id="hm-err-${keyOf(error)}" role="alert">✏️ ${esc(error)}</div>` : "");

export const home: Screen = {
  render({ app }) {
    const h = app.home;
    const name = h.name.trim();
    const invited = !!h.invite && h.code === h.invite; // a deep link #/join/CODE

    if (h.step === 2) {
      return `<section class="screen screen-home hm-step2" id="scr-home">
    <div class="card hm-card hm-me" id="hm-me">
      <span class="hm-me-face" id="hm-me-face-${keyOf(h.avatar)}">${face(h.avatar)}</span>
      <span class="hm-me-txt">
        <span class="hm-me-hi" aria-hidden="true">HELLO my name is</span>
        <b class="hm-me-name" title="${esc(name)}">${esc(name)}</b>
        <small class="hm-me-nick">${esc(nick(h.avatar))}</small>
      </span>
      <button class="btn ghost hm-change" id="hm-change" data-action="homeBack" aria-label="Change your name or student"><span aria-hidden="true">✏️</span> Change</button>
    </div>
    ${notices(app.closedReason, h.resuming)}
    <h2 class="hm-where" id="hm-where">Where to?</h2>

    <div class="hm-ways" id="hm-ways">
      <div class="card hm-card hm-join ${invited ? "invited" : ""}" id="hm-join">
        <h2>🚪 Join a class</h2>
        ${invited ? `<span class="hm-invited" aria-hidden="true">INVITED</span>` : ""}
        <div class="hm-join-row">
          <label class="hm-sr" for="joinCode">Classroom code</label>
          <input id="joinCode" placeholder="CODE" maxlength="5" autocapitalize="characters" autocomplete="off" spellcheck="false"
                 enterkeyhint="go" value="${esc(h.code)}" class="code-input" />
          <button class="btn ${h.busy ? "hm-busy" : ""}" data-action="join" ${h.busy ? "disabled" : ""}><span>${h.busy ? "Joining…" : "Join"}</span></button>
        </div>
      </div>
      <div class="card hm-card hm-create" id="hm-create">
        <h2>🔔 Start a class</h2>
        <p class="hint">You'll be the teacher (host) of a new classroom.</p>
        <button class="btn secondary ${h.busy ? "hm-busy" : ""}" data-action="create" ${h.busy ? "disabled" : ""}><span>${h.busy ? "Creating…" : "Create"}</span></button>
      </div>
    </div>
    <button class="btn ghost hm-practice" id="hm-practice" data-action="practice" ${h.busy ? "disabled" : ""}><span aria-hidden="true">🤖 </span>Practice with bots</button>
    ${errorLine(app.error)}
    <p class="footer-note hm-foot" id="hm-foot">3–10 classmates · phones out · one voice call · bots welcome</p>
    </section>`;
    }

    const needName = !!app.error && !name;
    const go = invited ? `Join class ${esc(h.invite!)}` : "Next";
    return `<section class="screen screen-home hm-step1" id="scr-home">
    <h1 class="title hm-title" id="hm-title">
      <span class="hm-t1"><span aria-hidden="true">🏫 </span>How Did You</span>
      <span class="hm-t2">Know That?!</span>
    </h1>
    <p class="tagline hm-tagline" id="hm-tagline">Pop quiz! One classmate secretly sees the answers. Catch them before they graduate.</p>
    <button class="btn ghost hm-howto" id="hm-howto" data-action="howto"><span aria-hidden="true">▶</span> How to play <small>1 min</small></button>
    ${notices(app.closedReason, h.resuming)}

    <div class="card hm-card hm-namecard ${needName ? "need-name" : ""}" id="hm-namecard">
      <div class="hello">
        <div class="hello-band" aria-hidden="true"><span class="hello-big">HELLO</span><span class="hello-small">my name is</span></div>
        <div class="hello-body">
          <span class="hello-av" id="hello-av-${keyOf(h.avatar)}" aria-hidden="true">${face(h.avatar)}</span>
          <label class="hm-sr" for="playerName">Your name</label>
          <input id="playerName" class="hello-input" data-size="${tagSize(name)}" placeholder="your name here" maxlength="20" autocomplete="off"
                 autocapitalize="words" spellcheck="false" enterkeyhint="${invited ? "go" : "next"}" value="${esc(h.name)}" />
        </div>
      </div>
      <div class="hm-photo-head">
        <span id="hm-photo-h">📸 Pick your student</span>
        <b class="hm-nick" id="hm-nick-${keyOf(h.avatar)}" aria-live="polite">${esc(nick(h.avatar))}</b>
      </div>
      <div class="av-grid" role="group" aria-labelledby="hm-photo-h">
        ${AVATARS.map(
          (a) =>
            `<button class="av-pick ${h.avatar === a ? "sel" : ""}" data-action="pickAvatar" data-av="${a}" aria-label="${esc(nick(a))}" aria-pressed="${h.avatar === a}"><span class="av-face" aria-hidden="true">${face(a)}</span></button>`,
        ).join("")}
      </div>
    </div>

    <div class="hm-next-dock" id="hm-next-dock">
      <button class="btn hm-next ${h.busy ? "hm-busy" : ""}" id="hm-next" data-action="homeNext" ${h.busy ? "disabled" : ""}><span>${h.busy ? "Joining…" : `${go} <span aria-hidden="true">→</span>`}</span></button>
      ${invited ? `<button class="btn ghost hm-elsewhere" id="hm-elsewhere" data-action="homeElsewhere" ${h.busy ? "disabled" : ""}>or start your own class</button>` : ""}
    </div>
    ${errorLine(app.error)}
    ${reportCard()}
    <p class="hm-credits" id="hm-credits">Some questions from <a href="https://opentdb.com" target="_blank" rel="noopener">Open Trivia Database</a> (<a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noopener">CC BY-SA 4.0</a>) · Host voice and students drawn with ElevenLabs</p>
    </section>`;
  },
};
