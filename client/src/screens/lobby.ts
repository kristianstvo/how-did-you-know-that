// 2. Lobby (spec 07; motion: 08-reveal-direction.md §4) — a classroom before
// the bell. Event-driven (no timeline): everything animates on INSERTION, and
// every block has a stable id so the morph never re-plays or cross-matches.
//   · the room-code letters drop onto the chalkboard (50ms deco stagger)
//   · each classmate's row pops in as they join (id="roster-<id>"); bots
//     "boot" with a 🤖 spin before their avatar appears
//   · the class-size warning is a sticky note under the roster
//   · the sticky Start dock gives ONE glow pulse when it becomes ready
//   · the copy toast (app.ui.toast) slides up out of the dock
// Desk numbers = seat order (players[] order), the order the vote grid uses.
import { renderSVG } from "uqr";
import { MAX_PLAYERS, MIN_PLAYERS } from "../../../shared/protocol";
import { av, esc, playerBadges, sessionTab } from "./common";
import type { Screen } from "./types";

const keyOf = (str: string) => {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
};

// <details> keeps its open state in the DOM, and the morph strips any
// attribute the render doesn't emit — so without this, every broadcast (a
// classmate joining, a setting changing) would snap "How to play" shut while
// someone is reading it. Remember the reader's choice and render it back.
let howOpen = false;
if (typeof document !== "undefined") {
  document.addEventListener(
    "toggle",
    (ev) => {
      const el = ev.target as HTMLDetailsElement | null;
      if (el?.id === "lb-how") howOpen = el.open;
    },
    true,
  );
}

// One QR per invite link, drawn once. Plain black on white, medium error
// correction: what phone cameras read fastest from across a table.
const qrCache = new Map<string, string>();
const qrFor = (url: string) => {
  let svg = qrCache.get(url);
  if (!svg) {
    svg = renderSVG(url, { ecc: "M", border: 2, pixelSize: 8, whiteColor: "#ffffff", blackColor: "#111111" });
    qrCache.set(url, svg);
  }
  return svg;
};

const RULES = [
  "The class answers the same <b>10 questions</b>, each from a different school subject (100 → 200 → 400 points). One classmate is secretly <b>the cheater</b> and sees the correct answers.",
  "The cheater <b>graduates instantly</b> by reaching the public score line on the grade book. Everyone else wins by catching them first.",
  "After every question, everyone's picks and <b>answer times</b> go up on the board. Suspicious? Each player holds <b>one accusation</b> per period — raise your hand during a reveal to force a vote. Plurality goes to <b>detention</b>.",
  "Detention for the cheater → class wins. Detention for an innocent → they keep answering but lose their vote, and the cheater's graduation line <b>drops by {drop}</b>.{strikes} Ties send nobody.",
  "Anyone who reaches the line and <b>no siren goes off</b> is proven innocent — <b>cleared</b>.",
  "If nobody wins by question 10, <b>top of the class</b> takes the period — whoever they are. Semester points add up across periods.",
];

export const lobby: Screen = {
  render({ app, s }) {
    const connected = s.players.filter((p) => p.connected).length;
    const shareUrl = `${location.origin}${location.pathname}#/join/${s.roomCode}`;
    const canStart = connected >= MIN_PLAYERS && !s.loadingQuestions;
    const between = s.matchNumber > 0;
    const hour = ((7 + s.matchNumber) % 12) + 1; // 8:59 — one minute to the bell
    const letters = [...s.roomCode];
    const k = s.settings.strikes;
    const strikesRule = k > 0 ? ` <b>${k === 1 ? "One wrong detention" : `${k} wrong detentions`}</b> and the cheater graduates on the spot.` : "";

    const rows = s.players
      .map((p, i) => {
        const me = p.id === app.selfId;
        return `<div class="player-li lb-row ${p.connected ? "" : "off"} ${p.isBot ? "is-bot" : ""} ${me ? "is-me" : ""}" id="roster-${p.id}" style="--i:${i}">
          <span class="lb-desk" aria-hidden="true">${i + 1}</span>
          <span class="lb-av">${av(p)}${p.isBot ? `<span class="lb-boot" aria-hidden="true">🤖</span>` : ""}</span>
          <span class="nm" title="${esc(p.name)}">${esc(p.name)}</span>
          ${me ? `<span class="badge you">YOU</span>` : ""}${playerBadges(p)}
          ${between ? `<span class="lb-pts">${s.sessionBoard[p.id] ?? 0}<small> pts</small></span>` : ""}
          ${
            app.isHost && p.isBot
              ? `<button class="bot-x" data-action="removeBot" data-id="${p.id}" aria-label="Remove ${esc(p.name)}"><span aria-hidden="true">✕</span></button>`
              : ""
          }
        </div>`;
      })
      .join("");

    const hostNote = s.loadingQuestions
      ? "Printing 10 questions…"
      : connected < MIN_PLAYERS
        ? `Need ${MIN_PLAYERS}+ in class to start · add bots to test solo`
        : `${connected} at their desks · ring when everyone's seated`;

    const toast = app.ui.toast ? `<div class="lb-toast" id="lb-toast-${keyOf(app.ui.toast)}">${esc(app.ui.toast)}</div>` : "";

    return `<section class="screen screen-lobby ${app.isHost ? "is-host" : "is-guest"} ${between ? "between" : ""}" id="scr-lobby">
    ${sessionTab(app, s)}
    <header class="lb-head" id="lb-head"><span aria-hidden="true">🏫 </span>How Did You Know That?!</header>
    ${s.debugForcedCheater ? `<div class="warn" id="lb-debug" role="status">🧪 Test mode: the cheater is fixed, not random.</div>` : ""}

    <div class="lb-board" id="lb-board">
      <div class="lb-board-top" aria-hidden="true">
        <span>${between ? `Recess · period ${s.matchNumber + 1} next` : "Homeroom"}</span>
        <span class="lb-clock">🕘 ${hour}<i>:</i>59</span>
      </div>
      <div class="lb-board-label" id="lb-code-label">Classroom code</div>
      <span class="lb-sr">${letters.map(esc).join(" ")}</span>
      <div class="roomcode" aria-hidden="true">${letters.map((ch, i) => `<span class="rc-l" style="--i:${i}">${esc(ch)}</span>`).join("")}</div>
      <div class="lb-tray" aria-hidden="true"><i class="lb-chalk"></i><i class="lb-chalk lb-chalk-y"></i><i class="lb-eraser"></i></div>
    </div>
    <div class="lb-invite" id="lb-invite">
      <button class="btn secondary lb-share" id="lb-share" data-action="share" data-url="${esc(shareUrl)}"><span aria-hidden="true">📨</span> Share invite</button>
      <button class="btn secondary lb-qr-btn" id="lb-qr-btn" data-action="toggleQr" aria-haspopup="dialog" aria-expanded="${app.ui.qrOpen}"><span aria-hidden="true">📷</span> Show QR</button>
    </div>
    ${
      app.ui.qrOpen
        ? `<div class="overlay lb-qr" id="lb-qr" role="dialog" aria-modal="true" aria-labelledby="lb-qr-h" data-action="toggleQr">
            <div class="lb-qr-card" data-action="noop">
              <h2 id="lb-qr-h">Scan to join</h2>
              <div class="lb-qr-code" role="img" aria-label="QR code for the classroom invite link">${qrFor(shareUrl)}</div>
              <div class="lb-qr-room">Classroom <b>${esc(s.roomCode)}</b></div>
              <p class="lb-qr-hint">Point a phone camera here: it opens this classroom with the code filled in.</p>
            </div>
            <button class="btn lb-qr-close" id="lb-qr-close" data-action="toggleQr">Done</button>
          </div>`
        : ""
    }

    <div class="card lb-roster" id="lb-roster">
      <div class="lb-roster-head">
        <h2>📋 Attendance</h2>
        <span class="lb-count"><b id="lb-count-${s.players.length}">${s.players.length}</b>/${MAX_PLAYERS} desks</span>
      </div>
      <div class="lb-list">${rows}</div>
      ${
        connected === 3
          ? `<div class="lb-note" id="lb-note" role="status">📌 A class of 3 is chaos at the vote — 4+ recommended.</div>`
          : ""
      }
      ${
        app.isHost && s.players.length < MAX_PLAYERS
          ? `<button class="lb-addbot" id="lb-addbot" data-action="addBot"><span aria-hidden="true">＋ 🤖</span> Add a bot classmate</button>`
          : ""
      }
    </div>

    <details class="how" id="lb-how" ${howOpen ? "open" : ""}>
      <summary><span><span aria-hidden="true">📖 </span>How to play</span><span class="lb-chev" aria-hidden="true">▾</span></summary>
      ${RULES.map((r, i) => `<p style="--i:${i}">${r.replace("{drop}", String(s.settings.thresholdDrop)).replace("{strikes}", strikesRule)}</p>`).join("")}
    </details>

    ${
      app.isHost
        ? `<div class="card lb-rules" id="lb-rules">
            <h2>⚙️ Class rules <span class="chip">teacher only</span></h2>
            <div class="settings-grid">
              <label for="set-timer">Question timer<small>seconds per question (5–60)</small></label>
              <input id="set-timer" data-setting="questionTimerMs" type="number" inputmode="numeric" min="5" max="60" value="${s.settings.questionTimerMs / 1000}" />
              <label for="set-line">Graduation line<small>the cheater wins on reaching it</small></label>
              <input id="set-line" data-setting="threshold" type="number" inputmode="numeric" min="200" max="2300" step="100" value="${s.settings.threshold}" />
              <label for="set-drop">Drop per wrong detention<small>the line falls when an innocent is sent</small></label>
              <input id="set-drop" data-setting="thresholdDrop" type="number" inputmode="numeric" min="0" max="800" step="50" value="${s.settings.thresholdDrop}" />
              <label for="set-strikes">Strikes<small>wrong detentions before the cheater graduates (0 = off)</small></label>
              <input id="set-strikes" data-setting="strikes" type="number" inputmode="numeric" min="0" max="3" value="${s.settings.strikes}" />
            </div>
          </div>
          ${between ? `<button class="btn ghost lb-end" id="lb-end" data-action="endSession">🏁 End the school day · final report cards</button>` : ""}`
        : `<div class="lb-rules-ro" id="lb-rules">
            <span class="lb-rule">⏱ <b>${s.settings.questionTimerMs / 1000}s</b> per question</span>
            <span class="lb-rule">🎓 line <b>${s.settings.threshold}</b></span>
            <span class="lb-rule">⬇ <b>−${s.settings.thresholdDrop}</b> per wrong detention</span>
            ${k > 0 ? `<span class="lb-rule">✗ <b>${k}</b> strike${k === 1 ? "" : "s"} and they graduate</span>` : ""}
          </div>`
    }

    <div class="lb-dock" id="lb-dock">
      <div class="lb-toast-slot" role="status" aria-live="polite">${toast}</div>
      ${
        app.isHost
          ? `<button class="btn lb-start ${canStart ? "ready" : ""} ${s.loadingQuestions ? "busy" : ""}" id="lb-start" data-action="start" ${canStart ? "" : "disabled"}>
              <span class="lb-bell" aria-hidden="true">🔔</span> <span class="lb-start-l">${s.loadingQuestions ? "Printing the quiz…" : between ? "Start next period" : "Start class"}</span>
            </button>
            <p class="lb-need" id="lb-need">${hostNote}</p>`
          : `<p class="waiting lb-wait"><span class="lb-bell" aria-hidden="true">🔔</span> Waiting for the teacher to ring the bell…</p>`
      }
    </div>
    </section>`;
  },
};
