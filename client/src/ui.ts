// All eight screens (spec 07), school edition. Pure render: App -> HTML.
// Interactions are wired in main.ts via data-action attributes.
import { AVATARS, MAX_PLAYERS, MIN_PLAYERS, type PublicPlayer, type PublicState, type SecretState } from "../../shared/protocol";

export interface App {
  screen: "home" | "game";
  isHost: boolean;
  selfId: string;
  state: PublicState | null;
  secret: SecretState;
  error: string | null;
  closedReason: string | null;
  home: { name: string; code: string; avatar: string; busy: boolean };
  ui: {
    accuseConfirm: boolean;
    myPick: number | null;
    myVote: string | null;
    boardOpen: boolean;
  };
}

export const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const LETTERS = ["A", "B", "C", "D"];

const playerOf = (state: PublicState, id: string) => state.players.find((p) => p.id === id);
const nameOf = (state: PublicState, id: string) => {
  const p = playerOf(state, id);
  return p ? `${p.avatar} ${esc(p.name)}` : "???";
};

const av = (p: PublicPlayer) => `<span class="av">${p.avatar}</span>`;

const fmtTime = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

function playerBadges(p: PublicPlayer): string {
  let out = "";
  if (p.isHost) out += `<span class="badge host">TEACHER</span>`;
  if (p.isBot) out += `<span class="badge bot">BOT</span>`;
  if (p.banished) out += `<span class="badge banished">DETENTION</span>`;
  if (!p.connected && !p.isBot) out += `<span class="badge recon">reconnecting…</span>`;
  return out;
}

// ---------------- 1. Home / Join ----------------

function renderHome(app: App): string {
  return `
    <h1 class="title">🏫 How Did You Know That?!</h1>
    <p class="tagline">Pop quiz! One classmate secretly sees the answers.<br/>Catch them before they graduate.</p>
    ${app.closedReason ? `<div class="warn">${esc(app.closedReason)}</div>` : ""}
    ${app.error ? `<div class="err">${esc(app.error)}</div>` : ""}
    <div class="card">
      <h2>📛 Your name tag</h2>
      <input id="playerName" placeholder="Your name" maxlength="20" autocomplete="off" value="${esc(app.home.name)}" style="margin-bottom:10px" />
      <div class="av-grid">
        ${AVATARS.map(
          (a) => `<button class="av-pick ${app.home.avatar === a ? "sel" : ""}" data-action="pickAvatar" data-av="${a}">${a}</button>`,
        ).join("")}
      </div>
    </div>
    <div class="duo">
      <div class="card" style="margin-bottom:0">
        <h2>🚪 Join a class</h2>
        <input id="joinCode" placeholder="CODE" maxlength="5" autocapitalize="characters" autocomplete="off"
               value="${esc(app.home.code)}" class="code-input" />
        <button class="btn" data-action="join" ${app.home.busy ? "disabled" : ""}>${app.home.busy ? "Joining…" : "Join"}</button>
      </div>
      <div class="card" style="margin-bottom:0">
        <h2>🔔 Start a class</h2>
        <p class="hint">You'll be the teacher (host) of a new classroom.</p>
        <button class="btn secondary" data-action="create" ${app.home.busy ? "disabled" : ""}>${app.home.busy ? "Creating…" : "Create"}</button>
      </div>
    </div>
    <p class="footer-note">3–10 classmates · phones out · one voice call · bots welcome</p>`;
}

// ---------------- 2. Lobby ----------------

function renderLobby(app: App, s: PublicState): string {
  const connected = s.players.filter((p) => p.connected).length;
  const shareUrl = `${location.origin}${location.pathname}#/join/${s.roomCode}`;
  const canStart = connected >= MIN_PLAYERS && !s.loadingQuestions;
  return `
    ${sessionTab(app, s)}
    <h1 class="title" style="font-size:1.3rem;margin-top:6px">🏫 How Did You Know That?!</h1>
    <div class="card" style="text-align:center">
      <div class="hint" style="letter-spacing:2px">CLASSROOM CODE</div>
      <div class="roomcode">${esc(s.roomCode)}</div>
      <button class="btn secondary" data-action="share" data-url="${esc(shareUrl)}">Share invite link</button>
    </div>
    ${connected === 3 ? `<div class="warn">A class of 3 is chaos at the vote — 4+ recommended.</div>` : ""}
    <div class="card">
      <h2>🧑‍🏫 Class roster (${connected})</h2>
      ${s.players
        .map(
          (p) => `<div class="player-li ${p.connected ? "" : "off"}">
            ${av(p)}<span class="nm">${esc(p.name)}${p.id === app.selfId ? " (you)" : ""}</span>${playerBadges(p)}
            ${s.matchNumber > 0 ? `<span class="hint" style="font-weight:700">${s.sessionBoard[p.id] ?? 0} pts</span>` : ""}
            ${app.isHost && p.isBot ? `<button class="bot-x" data-action="removeBot" data-id="${p.id}" title="Remove bot">✕</button>` : ""}
          </div>`,
        )
        .join("")}
      ${
        app.isHost && s.players.length < MAX_PLAYERS
          ? `<button class="btn ghost" data-action="addBot" style="margin-top:8px">🤖 Add a bot classmate</button>`
          : ""
      }
    </div>
    <details class="how">
      <summary>📖 How to play</summary>
      <p>The class answers the same <b>10 questions</b>, each from a different school subject (100 → 200 → 400 points). One classmate is secretly <b>the cheater</b> and sees the correct answers.</p>
      <p>The cheater <b>graduates instantly</b> by reaching the public score line on the grade book. Everyone else wins by catching them first.</p>
      <p>After every question, everyone's picks and <b>answer times</b> go up on the board. Suspicious? Each player holds <b>one accusation</b> per period — raise your hand during a reveal to force a vote. Plurality goes to <b>detention</b>.</p>
      <p>Detention for the cheater → class wins. Detention for an innocent → they keep answering but lose their vote, and the cheater's graduation line <b>drops by ${s.settings.thresholdDrop}</b>. Ties send nobody.</p>
      <p>If nobody wins by question 10, <b>top of the class</b> takes the period — whoever they are. Semester points add up across periods.</p>
    </details>
    ${
      app.isHost
        ? `<div class="card">
            <h2>⚙️ Class rules <span class="chip">teacher</span></h2>
            <div class="settings-grid">
              <label>Question timer (seconds)</label><input data-setting="questionTimerMs" type="number" min="5" max="60" value="${s.settings.questionTimerMs / 1000}" />
              <label>Graduation line</label><input data-setting="threshold" type="number" min="200" max="2300" step="100" value="${s.settings.threshold}" />
              <label>Drop per wrong detention</label><input data-setting="thresholdDrop" type="number" min="0" max="800" step="50" value="${s.settings.thresholdDrop}" />
            </div>
          </div>
          <button class="btn" data-action="start" ${canStart ? "" : "disabled"}>
            ${s.loadingQuestions ? "Printing the quiz…" : s.matchNumber > 0 ? "🔔 Start next period" : "🔔 Start class"}
          </button>
          ${connected < MIN_PLAYERS ? `<p class="footer-note">Need at least ${MIN_PLAYERS} in class to start — add bots if you're testing solo.</p>` : ""}
          ${s.matchNumber > 0 ? `<button class="btn ghost" data-action="endSession">End the school day · final report cards</button>` : ""}`
        : `<p class="waiting">Waiting for the teacher to ring the bell…</p>`
    }`;
}

// ---------------- 3. Role assign ----------------

function renderRole(app: App): string {
  // Identical layout footprint for everyone (spec 07): the extra line is
  // always rendered; only the cheater's copy has text in it.
  return `
    <div class="role-screen">
      <div style="font-size:3rem">🔔</div>
      <div class="big">Class is in session.</div>
      <div>Someone in this class is cheating…</div>
      <div class="role-extra">${app.secret.isCheater ? "It's you. Play it cool. 😎" : ""}</div>
    </div>`;
}

// ---------------- 4. Question ----------------

function renderQuestion(app: App, s: PublicState): string {
  const m = s.match!;
  const q = m.question!;
  const self = s.players.find((p) => p.id === app.selfId);
  const answered = self?.answeredCurrent ?? false;
  const answeredCount = s.players.filter((p) => p.answeredCurrent).length;
  const total = s.players.filter((p) => p.connected).length;
  const cheatIdx = app.secret.correctIdx; // -1 for innocents
  return `
    ${sessionTab(app, s)}
    <div class="subject-strip">${q.subjectEmoji} ${esc(q.subject)} class</div>
    <div class="qhead">
      <span class="qnum">Q${m.questionIdx + 1}/${m.questionCount}</span>
      <span class="qpts">${q.points} pts</span>
      <div class="timer-wrap">
        <svg width="54" height="54" viewBox="0 0 54 54">
          <circle cx="27" cy="27" r="24" fill="none" stroke="var(--card2)" stroke-width="5"/>
          <circle class="timer-arc" cx="27" cy="27" r="24" fill="none" stroke="var(--accent)" stroke-width="5"
                  stroke-linecap="round" stroke-dasharray="150.8" stroke-dashoffset="0"
                  data-deadline="${q.deadline}" data-total="${s.settings.questionTimerMs}"/>
        </svg>
        <span class="tsec" data-count="${q.deadline}"></span>
      </div>
    </div>
    <div class="qtext">${esc(q.text)}</div>
    ${q.options
      .map((opt, i) => {
        const cls = [
          "opt",
          i === cheatIdx ? "cheat-mark" : "",
          answered && app.ui.myPick === i ? "picked" : "",
        ].join(" ");
        return `<button class="${cls}" data-action="answer" data-idx="${i}" ${answered ? "disabled" : ""}>
          <span class="letter">${LETTERS[i]}</span><span>${esc(opt)}</span>
        </button>`;
      })
      .join("")}
    ${answered ? `<div class="waiting">Pencil down. Waiting for the class… ${answeredCount}/${total}</div>` : ""}`;
}

// ---------------- 5. Reveal ----------------

function leaderboard(s: PublicState): string {
  const m = s.match!;
  const maxVal = Math.max(m.threshold, ...s.players.map((p) => p.score), 1);
  const thrPct = (m.threshold / maxVal) * 100;
  const sorted = [...s.players].sort((a, b) => b.score - a.score);
  return `
    <div class="board">
      <div class="board-title"><span>📋 GRADE BOOK</span><span class="thr">🎓 Cheater graduates at ${m.threshold}</span></div>
      ${sorted
        .map(
          (p) => `<div class="bar-row">
            <span class="nm">${p.avatar} ${esc(p.name)}${p.banished ? " 🪑" : ""}</span>
            <div class="track">
              <div class="fill" style="width:${(p.score / maxVal) * 100}%"></div>
              <div class="thr-line" style="left:${thrPct}%"></div>
            </div>
            <span class="sc">${p.score}</span>
          </div>`,
        )
        .join("")}
    </div>`;
}

function renderReveal(app: App, s: PublicState): string {
  const m = s.match!;
  const q = m.question!;
  const r = m.reveal!;
  const self = s.players.find((p) => p.id === app.selfId)!;
  const canAccuse = !self.tokenUsed && !self.banished && self.votingRights;
  const accuseTitle = self.banished
    ? "You're in detention — no accusing"
    : self.tokenUsed
      ? "You already used your accusation"
      : "";
  const isLast = m.questionIdx + 1 >= m.questionCount;
  return `
    ${sessionTab(app, s)}
    <div class="qhead">
      <span class="qnum">Q${m.questionIdx + 1}/${m.questionCount} · ${q.subjectEmoji} ${esc(q.subject).toUpperCase()} · GRADED</span>
      ${s.offlineQuestions ? `<span class="chip offline">offline questions</span>` : ""}
    </div>
    <div class="qtext" style="min-height:0;font-size:1.05rem">${esc(q.text)}</div>
    <div class="card" style="padding:10px 12px">
      <div style="font-weight:800;color:var(--good);margin-bottom:4px">✓ ${esc(q.options[r.correctIdx])}</div>
      ${r.rows
        .map((row) => {
          const p = s.players.find((pl) => pl.id === row.playerId)!;
          return `<div class="reveal-row" ${p.banished ? 'style="opacity:0.6"' : ""}>
            ${av(p)}<span class="nm">${esc(p.name)}${p.banished ? " 🪑" : ""}</span>
            <span class="pick">${row.pick === -1 ? "no answer" : esc(q.options[row.pick])}</span>
            <span class="time">${row.pick === -1 ? "—" : fmtTime(row.timeMs)}</span>
            <span class="mark ${row.correct ? "ok" : "no"}">${row.correct ? "✓" : "✗"}</span>
          </div>`;
        })
        .join("")}
    </div>
    <div class="card" style="padding:12px">${leaderboard(s)}</div>
    <div class="accuse-dock">
      <button class="btn accuse ${app.ui.accuseConfirm ? "confirm" : ""}" data-action="accuse"
              ${canAccuse ? "" : "disabled"} title="${esc(accuseTitle)}">
        ${app.ui.accuseConfirm ? "BURN YOUR ONLY ACCUSATION?" : "🙋 ACCUSE"}
      </button>
      ${
        app.isHost
          ? `<button class="btn secondary" data-action="advance" data-min-next="${r.minNextAt}" style="margin-top:10px">
              ${isLast ? "Final bell 🔔" : "Next question"}
            </button>`
          : ""
      }
    </div>`;
}

// ---------------- 6. Vote ----------------

function renderVote(app: App, s: PublicState): string {
  const m = s.match!;
  const v = m.vote!;
  const self = s.players.find((p) => p.id === app.selfId)!;
  const canVote = self.votingRights && !self.banished && !self.votedCurrent;
  const votedCount = s.players.filter((p) => p.votedCurrent).length;
  const targets = s.players.filter((p) => !p.banished);
  return `
    <div class="vote-screen">
      <div class="accused-banner">🙋 ${nameOf(s, v.accuserId)} says someone's cheating!</div>
      <div class="vote-sub">Who goes to detention? Plurality decides.</div>
      <div class="vote-count" data-count="${v.deadline}"></div>
      <div class="vote-grid">
        ${targets
          .map(
            (p) => `<button class="vote-cell ${app.ui.myVote === p.id ? "picked" : ""}"
              data-action="vote" data-id="${p.id}" ${canVote ? "" : "disabled"}>
              <span class="av">${p.avatar}</span> ${esc(p.name)}${p.id === app.selfId ? " (you)" : ""}
            </button>`,
          )
          .join("")}
      </div>
      <p class="waiting" style="margin-top:14px">
        ${
          self.banished
            ? "You're in detention — no vote for you."
            : !self.votingRights
              ? "You've lost voting rights."
              : self.votedCurrent
                ? "Vote handed in."
                : "Tap a classmate — no take-backs."
        }
        &nbsp;${votedCount} voted
      </p>
    </div>`;
}

function renderVoteResult(app: App, s: PublicState): string {
  const m = s.match!;
  const vr = m.voteResult!;
  const banner = vr.tie
    ? `<div class="result-banner tie">Tie — nobody goes to detention</div>`
    : vr.wasCheater
      ? `<div class="result-banner caught">CHEATER CAUGHT!</div>`
      : `<div class="result-banner wrong">${nameOf(s, vr.banishedId!)} was innocent!</div>`;
  return `
    <div class="vote-screen">
      ${banner}
      ${
        vr.newThreshold !== null
          ? `<div class="thr-drop">−${s.settings.thresholdDrop}! Cheater now graduates at ${vr.newThreshold}!</div>`
          : ""
      }
      ${vr.banishedId && !vr.wasCheater ? `<div class="vote-sub">🪑 Off to detention — they keep answering, but lose their vote.</div>` : ""}
      <div class="card" style="margin-top:16px">
        <h2>The votes</h2>
        ${
          Object.keys(vr.votes).length === 0
            ? `<p class="waiting">Nobody voted. Cowards.</p>`
            : Object.entries(vr.votes)
                .map(
                  ([voter, target]) => `<div class="vote-line">
                    <span class="voter">${nameOf(s, voter)}</span><span class="arrow">→</span><span class="target">${nameOf(s, target)}</span>
                  </div>`,
                )
                .join("")
        }
      </div>
      ${
        app.isHost
          ? `<button class="btn" data-action="advance">${vr.wasCheater ? "See report card" : "Back to class"}</button>`
          : `<p class="waiting">Waiting for the teacher…</p>`
      }
    </div>`;
}

// ---------------- 7. Match end ----------------

function renderMatchEnd(app: App, s: PublicState): string {
  const m = s.match!;
  const e = m.end!;
  const banner =
    e.reason === "cheater_banished"
      ? `<div class="end-banner caught">Cheater caught! 🎉</div>`
      : e.reason === "cheater_threshold"
        ? `<div class="end-banner cheater-win">🎓 The cheater graduated 🎓</div>`
        : `<div class="end-banner top">⭐ Top of the class! ⭐</div>`;
  const sorted = [...s.players].sort((a, b) => b.score - a.score);
  const delta = (id: string) => {
    const d = e.sessionDelta[id] ?? 0;
    const cls = d > 0 ? "pos" : d < 0 ? "neg" : "zero";
    return `<span class="delta ${cls}">${d > 0 ? "+" : ""}${d}</span>`;
  };
  return `
    <div class="end-screen">
      ${banner}
      <div class="cheater-reveal">The cheater was <b>${nameOf(s, e.cheaterId)}</b>${
        e.reason === "top_score" ? " — and they never got caught" : ""
      }</div>
      <div class="card">
        <h2>📄 Period ${s.matchNumber} · report card</h2>
        ${sorted
          .map(
            (p) => `<div class="player-li">
              ${av(p)}<span class="nm">${e.winnerIds.includes(p.id) ? "🏆 " : ""}${esc(p.name)}${p.id === e.cheaterId ? " 🎭" : ""}</span>
              ${playerBadges(p)}
              <span style="font-weight:900">${p.score}</span>
            </div>`,
          )
          .join("")}
      </div>
      <div class="card">
        <h2>📊 Semester standings</h2>
        ${sessionRows(s, delta)}
      </div>
      ${
        app.isHost
          ? `<button class="btn" data-action="advance">Back to homeroom</button>
             <button class="btn ghost" data-action="endSession">End the school day</button>`
          : `<p class="waiting">Waiting for the teacher…</p>`
      }
    </div>`;
}

// ---------------- 8. Session leaderboard ----------------

function sessionRows(s: PublicState, delta?: (id: string) => string): string {
  const sorted = [...s.players].sort((a, b) => (s.sessionBoard[b.id] ?? 0) - (s.sessionBoard[a.id] ?? 0));
  return sorted
    .map(
      (p, i) => `<div class="player-li">
        <span style="width:22px;color:var(--dim);font-weight:800">${i + 1}</span>
        ${av(p)}<span class="nm">${esc(p.name)}</span>
        ${delta ? delta(p.id) : ""}
        <span style="font-weight:900">${s.sessionBoard[p.id] ?? 0}</span>
      </div>`,
    )
    .join("");
}

function renderSessionEnd(app: App, s: PublicState): string {
  const sorted = [...s.players].sort((a, b) => (s.sessionBoard[b.id] ?? 0) - (s.sessionBoard[a.id] ?? 0));
  const top = sorted[0];
  return `
    <div class="end-screen">
      <div class="podium">
        <div style="font-size:3.4rem">🎓</div>
        <div class="champ">${top ? `${top.avatar} ${esc(top.name)}` : ""}</div>
        <div class="hint">Valedictorian, with ${s.sessionBoard[top?.id ?? ""] ?? 0} semester points</div>
      </div>
      <div class="card"><h2>📊 Final standings · ${s.matchNumber} period${s.matchNumber === 1 ? "" : "s"}</h2>${sessionRows(s)}</div>
      <button class="btn secondary" data-action="home">Back to school</button>
    </div>`;
}

// ---------------- Shell ----------------

function sessionTab(app: App, s: PublicState): string {
  if (s.matchNumber === 0) return "";
  const overlay = app.ui.boardOpen
    ? `<div class="overlay" data-action="toggleBoard">
        <div class="card"><h2>📊 Semester standings</h2>${sessionRows(s)}</div>
      </div>`
    : "";
  return `<button class="sess-tab" data-action="toggleBoard" title="Semester standings">🎓</button>${overlay}`;
}

export function renderApp(app: App): string {
  if (app.screen === "home" || !app.state) return renderHome(app);
  const s = app.state;
  switch (s.phase) {
    case "lobby":
      return renderLobby(app, s);
    case "role":
      return renderRole(app);
    case "question":
      return renderQuestion(app, s);
    case "reveal":
      return renderReveal(app, s);
    case "vote":
      return renderVote(app, s);
    case "voteResult":
      return renderVoteResult(app, s);
    case "matchEnd":
      return renderMatchEnd(app, s);
    case "sessionEnd":
      return renderSessionEnd(app, s);
  }
}
