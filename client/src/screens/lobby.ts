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
import { MAX_PLAYERS, MIN_PLAYERS, type Settings } from "../../../shared/protocol";
import { loadRecord } from "../record";
import { av, esc, playerBadges, sessionTab, soundToggle } from "./common";
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
// v0.13: open for a first-timer (no report card on this phone yet).
let howOpen = typeof localStorage !== "undefined" && loadRecord().periods === 0;
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

// v0.10: pace presets — one tap instead of typing seconds on a phone.
const PACES = [
  { icon: "⚡", label: "Quick", ms: 10_000 },
  { icon: "🎓", label: "Classic", ms: 15_000 },
  { icon: "🧘", label: "Relaxed", ms: 25_000 },
] as const;

// v0.11: practice as a chosen role (only when everyone else is a bot).
const PRACTICE_ROLES = [
  { id: "random", icon: "🎲", label: "Random" },
  { id: "innocent", icon: "🕵️", label: "Innocent" },
  { id: "cheater", icon: "🤫", label: "Cheater" },
] as const;

/** v0.13 rules at a glance: four cards a first-timer reads in ten seconds,
 *  then the fine print. Numbers come from this class's own settings. */
function howCards(st: Settings): string {
  const k = st.strikes;
  const strikeRule = k > 0 ? `${k === 1 ? "One wrong detention" : `${k === 2 ? "Two" : k} wrong detentions`} and they graduate.` : "A wrong detention lowers their line.";
  const t = st.tierPoints;
  const cards = [
    { icon: "✏️", title: "10 questions", text: `Everyone answers the same quiz. Easy → hard: ${t.easy} · ${t.medium} · ${t.hard} points.` },
    { icon: "🤫", title: "One cheater", text: `Sees a faint dot on the right answer. Graduates at 🎓 ${st.threshold} points.` },
    { icon: "👀", title: "Watch the board", text: "Who's right <i>and</i> fast on the hard ones? Point 👉 at a suspect: free and public." },
    { icon: "🙋", title: "Accuse", text: `One accusation each forces a vote. Catch the cheater: the class wins. ${strikeRule}` },
  ];
  return cards
    .map((c, i) => `<div class="how-card" style="--i:${i}"><span class="how-ic" aria-hidden="true">${c.icon}</span><b>${c.title}</b><span>${c.text}</span></div>`)
    .join("");
}

const FINE_PRINT = [
  "A wrong detention also drops the line by <b>{drop}</b>, and that classmate loses their vote (but keeps answering). Ties send nobody.",
  "Anyone over the line with <b>no siren</b> is proven innocent: <b>CLEARED</b>.",
  "Nobody wins by Q10? <b>Top of the class</b> takes the period.",
  "<b>Gold stars ⭐</b> add up over the day: +2 for voting the cheater into detention (+1 for whoever accused), −1 for voting an innocent in, +3 for a cheater who graduates, +2 for top of the class.",
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
            app.isHost && !p.isHost && (p.isBot || !p.connected)
              ? `<button class="bot-x" data-action="removePlayer" data-id="${p.id}" aria-label="${p.isBot ? "Remove" : "Clear the seat of"} ${esc(p.name)}"><span aria-hidden="true">✕</span></button>`
              : ""
          }
        </div>`;
      })
      .join("");

    const hostNote = s.loadingQuestions
      ? "Questions on the way…"
      : connected < MIN_PLAYERS
        ? `Need ${MIN_PLAYERS}+ in class to start · add bots to test solo`
        : `${connected} at their desks · ring when everyone's seated`;

    const toast = app.ui.toast ? `<div class="lb-toast" id="lb-toast-${keyOf(app.ui.toast)}">${esc(app.ui.toast)}</div>` : "";

    return `<section class="screen screen-lobby ${app.isHost ? "is-host" : "is-guest"} ${between ? "between" : ""}" id="scr-lobby">
    ${sessionTab(app, s)}
    ${soundToggle("lb-snd")}
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
    ${
      app.tv
        ? `<div class="card lb-tvjoin" id="lb-tvjoin">
            <div class="lb-qr-code" role="img" aria-label="QR code for the classroom invite link">${qrFor(shareUrl)}</div>
            <p>📱 Scan to join, or open <b>${esc(location.host)}</b> and type <b>${esc(s.roomCode)}</b></p>
          </div>`
        : ""
    }
    <div class="lb-invite" id="lb-invite">
      <button class="btn secondary lb-share" id="lb-share" data-action="share" data-url="${esc(shareUrl)}"><span aria-hidden="true">📨</span> Invite</button>
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
              ${app.isHost ? `<p class="lb-qr-tv">📺 Big screen? On a TV or laptop open <b>${esc(location.host)}${esc(location.pathname === "/" ? "" : location.pathname)}/#/tv/${esc(s.roomCode)}</b></p>` : ""}
            </div>
            <button class="btn lb-qr-close" id="lb-qr-close" data-action="toggleQr">Done</button>
          </div>`
        : ""
    }

    <div class="card lb-roster" id="lb-roster">
      <div class="lb-roster-head">
        <h2>📋 Attendance</h2>
        <span class="lb-count">${s.screens ? `<span class="lb-screens" title="Big screens watching">📺${s.screens > 1 ? ` ${s.screens}` : ""}</span> ` : ""}<b id="lb-count-${s.players.length}">${s.players.length}</b>/${MAX_PLAYERS} desks</span>
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
      <div class="how-cards">${howCards(s.settings)}</div>
      <ul class="how-fine">${FINE_PRINT.map((r, i) => `<li style="--i:${i + 4}">${r.replace("{drop}", String(s.settings.thresholdDrop))}</li>`).join("")}</ul>
    </details>

    ${
      app.isHost
        ? `<div class="card lb-rules" id="lb-rules">
            <h2>⚙️ Class rules <span class="chip">teacher only</span></h2>
            <div class="lb-pace" role="group" aria-label="Pace">${PACES.map((p) => {
              const on = s.settings.questionTimerMs === p.ms;
              return `<button class="lb-pace-btn${on ? " on" : ""}" id="pace-${p.label.toLowerCase()}" data-action="pace" data-ms="${p.ms}" aria-pressed="${on}"><span class="lb-pace-ic" aria-hidden="true">${p.icon}</span><b>${p.label}</b><small>${p.ms / 1000}s a question</small></button>`;
            }).join("")}</div>
            ${
              s.players.length > 1 && s.players.every((p) => p.isHost || p.isBot)
                ? `<div class="lb-roles" role="group" aria-label="Practice as"><span class="lb-roles-l">Practice as</span>${PRACTICE_ROLES.map((r) => {
                    const on = s.settings.practiceRole === r.id;
                    return `<button class="lb-role-btn${on ? " on" : ""}" id="role-${r.id}" data-action="practiceRole" data-role="${r.id}" aria-pressed="${on}"><span aria-hidden="true">${r.icon}</span> ${r.label}</button>`;
                  }).join("")}</div>`
                : ""
            }
            <details class="lb-adv" id="lb-adv">
              <summary><span>Advanced</span><span class="lb-adv-sum">line ${s.settings.threshold} · −${s.settings.thresholdDrop} · ${k} strike${k === 1 ? "" : "s"}</span><span class="lb-chev" aria-hidden="true">▾</span></summary>
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
            </details>
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
