// 1. Home / Join (spec 07; motion: 08-reveal-direction.md §4).
// Beats (all on insertion; the shell morphs, so nothing replays per keystroke):
//   title wobble-in at 0 · tagline 150 · name tag / Join / Start cards rise
//   with the 50ms deco stagger from 200 · footer 400.
// You write your name straight onto the "HELLO my name is" sticker (the input
// IS the sticker's name line; the focused input is never clobbered by a
// re-render) next to the chosen avatar, which pops on every pick. Long names
// shrink the marker as they are typed (data-size, set live below).
// Errors shake (hd-shake) — and shake again on every Join/Create tap that
// repeats the same error.
import { AVATARS } from "../../../shared/protocol";
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

// The morph re-syncs every NON-focused input to its rendered value, and the
// shell only stores the typed name. Remember what was typed into the code box
// here, so a name keystroke or an avatar tap never wipes a half-typed code.
let typedCode: string | null = null;
if (typeof document !== "undefined") {
  document.addEventListener(
    "input",
    (ev) => {
      const el = ev.target as HTMLInputElement | null;
      if (el?.id === "joinCode") typedCode = el.value;
      // The morph leaves a focused input alone, so size the marker here.
      if (el?.id === "playerName") el.dataset.size = tagSize(el.value.trim());
    },
    true,
  );
}

export const home: Screen = {
  render({ app }) {
    const h = app.home;
    const name = h.name.trim();
    const code = typedCode ?? h.code;
    const invited = h.code.length === 5; // deep link #/join/CODE pre-filled it
    const needName = !!app.error && !name;
    return `<section class="screen screen-home" id="scr-home">
    <h1 class="title hm-title" id="hm-title">
      <span class="hm-t1"><span aria-hidden="true">🏫 </span>How Did You</span>
      <span class="hm-t2">Know That?!</span>
    </h1>
    <p class="tagline hm-tagline" id="hm-tagline">Pop quiz! One classmate secretly sees the answers. Catch them before they graduate.</p>
    ${app.closedReason ? `<div class="warn hm-closed" id="hm-closed" role="status">🚪 ${esc(app.closedReason)}</div>` : ""}

    <div class="card hm-card hm-namecard ${needName ? "need-name" : ""}" id="hm-namecard">
      <div class="hello">
        <div class="hello-band" aria-hidden="true"><span class="hello-big">HELLO</span><span class="hello-small">my name is</span></div>
        <div class="hello-body">
          <span class="hello-av" id="hello-av-${keyOf(h.avatar)}" aria-hidden="true">${h.avatar}</span>
          <label class="hm-sr" for="playerName">Your name</label>
          <input id="playerName" class="hello-input" data-size="${tagSize(name)}" placeholder="your name here" maxlength="20" autocomplete="off"
                 autocapitalize="words" spellcheck="false" enterkeyhint="${invited ? "go" : "done"}" value="${esc(h.name)}" />
        </div>
      </div>
      <div class="av-grid" role="group" aria-label="Pick your avatar">
        ${AVATARS.map(
          (a) =>
            `<button class="av-pick ${h.avatar === a ? "sel" : ""}" data-action="pickAvatar" data-av="${a}" aria-label="Avatar ${a}" aria-pressed="${h.avatar === a}"><span class="av-face" aria-hidden="true">${a}</span></button>`,
        ).join("")}
      </div>
    </div>

    <div class="duo" id="hm-duo">
      <div class="card hm-card hm-join ${invited ? "invited" : ""}" id="hm-join">
        <h2>🚪 Join a class</h2>
        ${invited ? `<span class="hm-invited" aria-hidden="true">INVITED</span>` : ""}
        <label class="hm-sr" for="joinCode">Classroom code</label>
        <input id="joinCode" placeholder="CODE" maxlength="5" autocapitalize="characters" autocomplete="off" spellcheck="false"
               enterkeyhint="go" value="${esc(code)}" class="code-input" />
        <button class="btn ${h.busy ? "hm-busy" : ""}" data-action="join" ${h.busy ? "disabled" : ""}><span>${h.busy ? "Joining…" : "Join"}</span></button>
      </div>
      <div class="card hm-card hm-create" id="hm-create">
        <h2>🔔 Start a class</h2>
        <p class="hint">You'll be the teacher (host) of a new classroom.</p>
        <button class="btn secondary ${h.busy ? "hm-busy" : ""}" data-action="create" ${h.busy ? "disabled" : ""}><span>${h.busy ? "Creating…" : "Create"}</span></button>
      </div>
    </div>
    <button class="btn ghost hm-practice" id="hm-practice" data-action="practice" ${h.busy ? "disabled" : ""}><span aria-hidden="true">🤖 </span>Practice with bots</button>
    ${app.error ? `<div class="err hm-err" id="hm-err-${keyOf(app.error)}" role="alert">✏️ ${esc(app.error)}</div>` : ""}
    <p class="footer-note hm-foot" id="hm-foot">3–10 classmates · phones out · one voice call · bots welcome</p>
    </section>`;
  },
};
