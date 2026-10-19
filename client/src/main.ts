// App shell: session wiring, event delegation, routing to screen modules,
// countdown ticker, hash deep links (#/join/CODE) and fixture replay
// (#/fixture/<name>). Rendering: render.ts. Game logic: engine.ts.
import "./styles/tokens.css";
import "./style.css";
import "./styles/home.css";
import "./styles/lobby.css";
import "./styles/role.css";
import "./styles/question.css";
import "./styles/reveal.css";
import "./styles/vote.css";
import "./styles/voteResult.css";
import "./styles/matchEnd.css";
import "./styles/sessionEnd.css";
import "./styles/transitions.css";
import { REVEAL_TIMING } from "../../shared/choreo";
import { AVATARS, type Intent, type PublicState, type SecretState } from "../../shared/protocol";
import { clockStatus, serverNow } from "./clock";
import { startFixture } from "./fixture";
import { buzz } from "./haptics";
import { setSound, sfx, soundOn } from "./sound";
import { createHostSession, hasSeat, joinAsPlayer, type HostSession, type NetStatus, type PlayerSession } from "./net";
import { createRenderer, reducedMotion, type Router, type TransitionKind } from "./render";
import { home } from "./screens/home";
import { lobby } from "./screens/lobby";
import { matchEnd } from "./screens/matchEnd";
import { question } from "./screens/question";
import { reveal } from "./screens/reveal";
import { role } from "./screens/role";
import { sessionEnd } from "./screens/sessionEnd";
import type { App, Screen } from "./screens/types";
import { vote } from "./screens/vote";
import { voteResult } from "./screens/voteResult";
import { awake, keepAwake } from "./wakelock";

const root = document.getElementById("app")!;
const params = new URLSearchParams(location.search);

const app: App = {
  screen: "home",
  isHost: false,
  selfId: "",
  state: null,
  secret: { isCheater: false, correctIdx: -1 },
  error: null,
  closedReason: null,
  home: { name: "", code: "", avatar: "", busy: false },
  ui: { accuseConfirm: false, myPick: null, voteSel: null, myVote: null, boardOpen: false, qrOpen: false, pointOpen: false, toast: null },
  fixture: false,
};

let session: HostSession | PlayerSession | null = null;
/** When ACCUSE turned into "Burn your only token?" — a confirm tap that comes
 *  sooner than ACCUSE_ARM_MS after it is the second half of a double-tap. */
let accuseArmedAt = 0;
const ACCUSE_ARM_MS = 450;
/** A ballot that was picked but never handed in goes in this long before the
 *  vote closes (the host counts at the deadline). */
const AUTO_HAND_IN_MS = 1200;
let questionShownAt = 0; // local monotonic ms when this phone first showed the question
let lastPhase = "";
let lastQuestionKey = "";

const hashJoin = location.hash.match(/#\/join\/([A-Za-z0-9]+)/);
if (hashJoin) app.home.code = hashJoin[1].toUpperCase();
app.home.name = localStorage.getItem("hdykt-name") ?? "";
app.home.avatar = localStorage.getItem("hdykt-avatar") ?? AVATARS[Math.floor(Math.random() * AVATARS.length)];

// ---------------- Routing ----------------

const SCREENS: Record<PublicState["phase"], Screen> = {
  lobby,
  role,
  question,
  reveal,
  vote,
  voteResult,
  matchEnd,
  sessionEnd,
};

/** Which View Transition plays when moving INTO a phase from another. */
function transitionFor(from: string, to: string): TransitionKind {
  if (to === "vote" || to === "matchEnd") return "takeover";
  if (to === "reveal" && from === "question") return "flip";
  if (to === "question" || to === "role") return "rise";
  if (to === "voteResult" || (to === "reveal" && from === "voteResult")) return "fade";
  return "slide";
}

const phaseOfKey = (key: string) => (key === "session" ? "sessionEnd" : key.split("-")[0]);

const router: Router = {
  screenFor(a, prevKey) {
    const s = a.state;
    if (a.screen === "home" || !s) {
      return { key: "home", screen: home, ctx: null, transition: "slide" };
    }
    const m = s.match;
    const key =
      s.phase === "lobby"
        ? "lobby"
        : s.phase === "sessionEnd"
          ? "session"
          : `${s.phase}-${s.matchNumber}-${m?.questionIdx ?? 0}${s.phase === "vote" || s.phase === "voteResult" ? `-${m?.vote?.accuserId ?? m?.voteResult?.accuserId ?? ""}` : ""}`;
    const now = serverNow();
    const transition = transitionFor(phaseOfKey(prevKey), s.phase);
    return { key, screen: SCREENS[s.phase], ctx: { app: a, s, now, elapsed: now - s.phaseStartedAt, reduced: reducedMotion() }, transition };
  },
};

// Haptic punctuation (Android only; always mirrors something on screen —
// never for beats that rendered already settled).
let beatScreen = ""; // the screen the last beat belonged to
function onBeat(screenKey: string, beatKey: string, prev: string, settled: boolean): void {
  // "Entered" = a new screen, not merely its first beat (a screen can show
  // during its beat lead with no beat yet, then reach beat 0).
  const entered = screenKey !== beatScreen;
  beatScreen = screenKey;
  if (settled) return;
  const added = beatKey.split(",").filter((b) => b && !prev.split(",").includes(b));
  if (screenKey.startsWith("vote-") && entered) buzz([60, 40, 60]);
  if (screenKey.startsWith("matchEnd") && entered) buzz([90, 50, 90]);
  if (added.includes("answer")) buzz(25);
  if (added.includes("verdict") && screenKey.startsWith("voteResult")) buzz(70);
  if (added.includes("unmask")) buzz([40, 30, 120]);
  beatSounds(screenKey, added, entered);
}

/** Game-show sound on the same shared-clock beats as the motion (v0.6). Only
 *  public data decides what plays: the cheater's phone sounds the same. */
function beatSounds(screenKey: string, added: string[], entered: boolean): void {
  const phase = screenKey === "session" ? "sessionEnd" : screenKey.split("-")[0];
  const m = app.state?.match;
  if (phase === "role" && added.includes("bell")) sfx.bell();
  if (phase === "question") {
    if (entered) sfx.pop();
    if (added.some((b) => /^u\d+$/.test(b)) && !added.includes("pencils")) sfx.tick();
    if (added.includes("pencils")) sfx.whistle();
  }
  if (phase === "reveal" && m?.reveal) {
    const t = REVEAL_TIMING[m.reveal.stakes];
    if (added.includes("slap")) sfx.slaps(m.reveal.rows.length, t.slapStagger);
    if (added.includes("drumroll")) sfx.drumroll(t.drumroll);
    if (added.includes("answer")) sfx.sting();
    if (added.includes("evidence")) sfx.stamp();
    if (added.includes("grade") && m.reveal.lastBell.length) sfx.bell();
  }
  if (phase === "vote" && entered) sfx.gavel();
  if (phase === "voteResult") {
    if (added.includes("verdict")) sfx.stamp();
    if (added.includes("drop")) sfx.slide();
  }
  if (phase === "matchEnd" && entered && m?.end) {
    if (m.end.reason === "cheater_threshold") sfx.siren();
    else if (m.end.reason === "cheater_banished") sfx.fanfare();
    else sfx.bell();
  }
  if (phase === "sessionEnd" && entered) sfx.fanfare();
}

const renderer = createRenderer(root, router, app, tick, tick, onBeat);
// Test hook: the sync test reads each phone's clock estimate.
Object.assign(window.__hdykt!, { clock: clockStatus, awake });
const render = () => renderer.render();

// ---------------- Session events ----------------

/** Delivery slack allowed when back-dating the answer clock (one-way relay). */
const ANSWER_ALLOWANCE_MS = 300;
let lastMatchNumber = -1;

function onState(state: PublicState): void {
  const prevPhase = lastPhase;
  // A new match: forget last match's secret until this match's arrives, so a
  // stale "you were the cheater" can never render (it's re-sent at the bell).
  if (state.matchNumber !== lastMatchNumber) {
    // (Not on the very first state: a (re)join delivers its secret first.)
    if (lastMatchNumber !== -1 && (state.phase === "role" || state.phase === "lobby")) app.secret = { isCheater: false, correctIdx: -1 };
    lastMatchNumber = state.matchNumber;
  }
  app.state = state;
  lastPhase = state.phase;
  banner();
  if (state.phase === "question" && state.match?.question) {
    const qk = `${state.matchNumber}:${state.match.questionIdx}`;
    if (qk !== lastQuestionKey) {
      lastQuestionKey = qk;
      // Answer time counts from when the question started on the SHARED
      // clock (minus delivery slack), so a reload or a late packet can't make
      // a slow answer look lightning-fast.
      const q = state.match.question;
      const startedAt = q.deadline - state.settings.questionTimerMs;
      questionShownAt = performance.now() - Math.max(0, serverNow() - startedAt - ANSWER_ALLOWANCE_MS);
      app.ui.myPick = null;
    }
  }
  if (state.phase !== prevPhase) {
    app.ui.accuseConfirm = false;
    app.ui.qrOpen = false;
    app.ui.pointOpen = false;
    if (state.phase === "vote") {
      app.ui.myVote = null;
      app.ui.voteSel = null;
    }
    if (state.phase === "lobby" || state.phase === "matchEnd") app.ui.boardOpen = false;
  }
  render();
}

function onSecret(secret: SecretState): void {
  app.secret = secret;
  render();
}

function onClosed(reason: string): void {
  session = null;
  keepAwake(false);
  onNet("online");
  app.screen = "home";
  app.state = null;
  app.closedReason = reason;
  app.home.busy = false;
  render();
}

// ---------------- Connection banner (outside #app: never morphed) ----------------

const NET_COPY: Record<NetStatus, string> = {
  online: "",
  reconnecting: "📶 Reconnecting… your seat is saved",
  hostAway: "📵 The teacher's phone dropped out. Hang tight…",
};
const netEl = document.createElement("div");
netEl.id = "net";
netEl.setAttribute("role", "status");
document.body.prepend(netEl);
let netStatus: NetStatus = "online";
function onNet(status: NetStatus): void {
  netStatus = status;
  banner();
}
/** Connection trouble wins; otherwise tell a late arrival they're in the hallway. */
function banner(): void {
  // The host sees its own reconnect as "reconnecting", never "teacher away".
  let copy = netStatus === "reconnecting" && session?.kind === "host" ? "📶 Reconnecting… the class is waiting for you" : NET_COPY[netStatus];
  let status: string = netStatus;
  if (!copy && session && app.state?.hallway?.some((h) => h.id === app.selfId)) {
    copy = "🚪 You're in the hallway: watch this period, you'll get a seat at the next one";
    status = "hallway";
  }
  netEl.textContent = copy;
  netEl.classList.toggle("on", !!copy);
  netEl.dataset.status = status;
}

function act(intent: Intent): void {
  if (!session) return;
  if (session.kind === "host") session.engine.localIntent(intent);
  else session.sendIntent(intent);
}

// ---------------- Actions ----------------

async function createLobby(bots = 0): Promise<void> {
  const name = (document.getElementById("playerName") as HTMLInputElement).value.trim();
  if (!name) return showError("Write your name on the name tag first.");
  saveName(name);
  app.home.busy = true;
  app.error = null;
  render();
  try {
    // Test hook, honoured only on a local dev machine — and flagged to every
    // player in the lobby while active.
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);
    const forceCheaterName = local ? (params.get("debugCheater") ?? undefined) : undefined;
    session = await createHostSession(name, app.home.avatar, { onState, onSecret, onClosed, onNet }, { forceCheaterName });
    keepAwake(true);
    // Practice: five bot classmates, so a solo player can start right away.
    for (let i = 0; i < bots; i++) session.engine.addBot();
    app.isHost = true;
    app.selfId = session.selfId;
    app.screen = "game";
    app.closedReason = null;
  } catch (e) {
    showError((e as Error).message);
  }
  app.home.busy = false;
  render();
}

async function joinLobby(): Promise<void> {
  const code = (document.getElementById("joinCode") as HTMLInputElement).value.trim().toUpperCase();
  const name = (document.getElementById("playerName") as HTMLInputElement).value.trim();
  if (code.length !== 5) return showError("Classroom codes are 5 characters.");
  if (!name) return showError("Write your name on the name tag first.");
  saveName(name);
  app.home.code = code;
  app.home.busy = true;
  app.error = null;
  render();
  try {
    session = await joinAsPlayer(code, name, app.home.avatar, { onState, onSecret, onClosed, onNet });
    keepAwake(true);
    app.isHost = false;
    app.selfId = session.selfId;
    app.screen = "game";
    app.closedReason = null;
    history.replaceState(null, "", `${location.pathname}${location.search}#/join/${code}`); // rejoinable link
  } catch (e) {
    showError((e as Error).message);
  }
  app.home.busy = false;
  render();
}

function saveName(name: string): void {
  app.home.name = name;
  localStorage.setItem("hdykt-name", name);
  localStorage.setItem("hdykt-avatar", app.home.avatar);
}

function showError(msg: string): void {
  app.error = msg;
  app.home.busy = false;
  render();
}

let toastTimer = 0;
function toast(msg: string): void {
  app.ui.toast = msg;
  render();
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    app.ui.toast = null;
    render();
  }, 2200);
}

async function shareLink(url: string): Promise<void> {
  try {
    if (navigator.share) {
      await navigator.share({ title: "How Did You Know That?!", text: "Join my classroom — someone's about to cheat on the quiz.", url });
    } else {
      await navigator.clipboard.writeText(url);
      toast("Invite link copied!");
    }
  } catch {
    /* user dismissed the share sheet */
  }
}

/** One line about the day for the group chat (v0.8). Public results only. */
async function shareDay(): Promise<void> {
  const s = app.state;
  if (!s) return;
  const name = (id: string) => s.players.find((p) => p.id === id)?.name ?? "";
  const top = Math.max(0, ...s.players.map((p) => s.sessionBoard[p.id] ?? 0));
  const champs = s.players.filter((p) => (s.sessionBoard[p.id] ?? 0) === top).map((p) => p.name);
  const award = s.dayAwards?.[0];
  const text = `🎓 Class of ${s.roomCode}: ${champs.join(" & ")} finished top of the class after ${s.matchNumber} period${s.matchNumber === 1 ? "" : "s"}.${award ? ` ${award.icon} ${award.title}: ${name(award.playerId)}.` : ""} How Did You Know That?!`;
  try {
    if (navigator.share) await navigator.share({ title: "How Did You Know That?!", text, url: `${location.origin}${location.pathname}` });
    else {
      await navigator.clipboard.writeText(`${text} ${location.origin}${location.pathname}`);
      toast("Copied. Paste it in the group chat!");
    }
  } catch {
    /* share sheet dismissed */
  }
}

function downloadLog(): void {
  if (session?.kind !== "host") return;
  const blob = new Blob([session.eventLog()], { type: "application/x-ndjson" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `hdykt-${session.code}-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "")}.jsonl`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

root.addEventListener("click", (ev) => {
  const btn = (ev.target as HTMLElement).closest<HTMLElement>("[data-action]");
  if (!btn || (btn as HTMLButtonElement).disabled) return;
  const action = btn.dataset.action!;
  const host = session?.kind === "host" ? session : null;
  switch (action) {
    case "create":
      void createLobby();
      break;
    case "join":
      void joinLobby();
      break;
    case "practice":
      void createLobby(5);
      break;
    case "share":
      void shareLink(btn.dataset.url!);
      break;
    case "pickAvatar": {
      app.home.avatar = btn.dataset.av!;
      const nameInput = document.getElementById("playerName") as HTMLInputElement | null;
      if (nameInput) app.home.name = nameInput.value;
      localStorage.setItem("hdykt-avatar", app.home.avatar);
      render();
      break;
    }
    case "addBot":
      host?.engine.addBot();
      break;
    case "removeBot":
    case "removePlayer":
      host?.engine.removePlayer(btn.dataset.id!);
      break;
    case "pace":
      host?.engine.updateSettings({ questionTimerMs: Number(btn.dataset.ms) });
      break;
    case "newDay":
      host?.engine.newDay();
      break;
    case "start":
      if (host) void host.engine.startMatch();
      break;
    case "endSession":
      host?.engine.endSession();
      break;
    case "advance":
      host?.engine.advance();
      break;
    case "skipShow":
      host?.engine.skipShow();
      break;
    case "downloadLog":
      downloadLog();
      break;
    case "answer": {
      if (app.ui.myPick !== null) break; // locked on first tap
      const idx = Number(btn.dataset.idx);
      app.ui.myPick = idx;
      buzz(15);
      sfx.click();
      act({
        kind: "answer",
        questionIdx: app.state?.match?.questionIdx ?? 0,
        optionIdx: idx,
        // Elapsed since THIS phone showed the question (local monotonic clock).
        clientElapsedMs: performance.now() - questionShownAt,
      });
      render();
      break;
    }
    case "accuse":
      // Confirmation tap required: "Burn your only accusation?" (spec 07). A
      // confirm tap within ACCUSE_ARM_MS is a fumbled double-tap: ignored.
      if (!app.ui.accuseConfirm) {
        app.ui.accuseConfirm = true;
        accuseArmedAt = performance.now();
        render();
        setTimeout(() => {
          if (app.ui.accuseConfirm) {
            app.ui.accuseConfirm = false;
            render();
          }
        }, 3500);
      } else if (performance.now() - accuseArmedAt >= ACCUSE_ARM_MS) {
        app.ui.accuseConfirm = false;
        buzz(40);
        act({ kind: "burnToken" });
      }
      break;
    case "vote": {
      // Tap = pick (changeable); the ballot only goes in with "Hand in".
      if (app.ui.myVote) break;
      app.ui.voteSel = btn.dataset.id!;
      buzz(10);
      render();
      break;
    }
    case "handIn":
      handIn();
      break;
    case "pointSheet":
      app.ui.pointOpen = !app.ui.pointOpen;
      render();
      break;
    case "point":
      // Free and public; "" = stop pointing.
      app.ui.pointOpen = false;
      buzz(10);
      sfx.click();
      act({ kind: "point", targetPlayerId: btn.dataset.id || null });
      render();
      break;
    case "toggleSound":
      setSound(!soundOn());
      render();
      break;
    case "shareDay":
      void shareDay();
      break;
    case "toggleQr":
      app.ui.qrOpen = !app.ui.qrOpen;
      render();
      break;
    case "toggleBoard":
      app.ui.boardOpen = !app.ui.boardOpen;
      render();
      break;
    case "home":
      location.hash = "";
      location.reload();
      break;
  }
});

// Live name tag: the home screen previews the name as it's typed (morphing
// keeps the caret; ignoreActiveValue never clobbers the input itself).
root.addEventListener("input", (ev) => {
  const input = ev.target as HTMLInputElement;
  if (input.id === "playerName") {
    app.home.name = input.value;
    render();
  }
  // Keep a half-typed code in state so re-renders never wipe it.
  if (input.id === "joinCode") app.home.code = input.value.toUpperCase();
});

// Phone keyboards: "Go" on the classroom code joins. On the name, "Go" joins
// when the code is already there (an invite link); otherwise it just closes
// the keyboard so Join and Create come back into view.
root.addEventListener("keydown", (ev) => {
  if (ev.key !== "Enter" || app.home.busy) return;
  const el = ev.target as HTMLInputElement;
  if (el.id === "joinCode") {
    ev.preventDefault();
    void joinLobby();
  } else if (el.id === "playerName") {
    ev.preventDefault();
    const code = (document.getElementById("joinCode") as HTMLInputElement | null)?.value.trim() ?? "";
    if (code.length === 5) void joinLobby();
    else el.blur();
  }
});

// Host settings inputs (lobby only).
root.addEventListener("change", (ev) => {
  const input = ev.target as HTMLInputElement;
  const key = input.dataset.setting;
  if (!key || session?.kind !== "host") return;
  const num = Number(input.value);
  if (!Number.isFinite(num)) return;
  if (key === "questionTimerMs") session.engine.updateSettings({ questionTimerMs: Math.max(5, Math.min(60, num)) * 1000 });
  else if (key === "threshold") session.engine.updateSettings({ threshold: Math.max(200, num) });
  else if (key === "thresholdDrop") session.engine.updateSettings({ thresholdDrop: Math.max(0, num) });
  else if (key === "strikes") session.engine.updateSettings({ strikes: Math.max(0, Math.min(3, Math.round(num))) });
});

function handIn(): void {
  const id = app.ui.voteSel;
  if (!id || app.ui.myVote || app.state?.phase !== "vote") return;
  app.ui.myVote = id;
  buzz(20);
  sfx.stamp();
  act({ kind: "castVote", targetPlayerId: id });
  render();
}

// ---------------- Countdown ticker (text only; motion is CSS on the compositor) ----------------

function tick(): void {
  const now = serverNow();
  root.querySelectorAll<HTMLElement>("[data-count]").forEach((el) => {
    const v = String(Math.max(0, Math.ceil((Number(el.dataset.count) - now) / 1000)));
    if (el.textContent !== v) el.textContent = v;
  });
  // A picked-but-not-handed-in ballot goes in just before the vote closes.
  const v = app.state?.phase === "vote" ? app.state.match?.vote : null;
  if (v && app.ui.voteSel && !app.ui.myVote && now >= v.deadline - AUTO_HAND_IN_MS) handIn();
  // Host "Next" respects the reveal minimum (spec 01).
  root.querySelectorAll<HTMLButtonElement>("[data-min-next]").forEach((el) => {
    const off = now < Number(el.dataset.minNext);
    if (el.disabled !== off) el.disabled = off;
  });
}

// Keyboard: Escape closes the semester standings sheet.
document.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape" && app.ui.pointOpen) {
    app.ui.pointOpen = false;
    render();
    document.getElementById("rv-point")?.focus();
  }
  if (ev.key === "Escape" && app.ui.qrOpen) {
    app.ui.qrOpen = false;
    render();
    document.getElementById("lb-qr-btn")?.focus();
  }
  if (ev.key === "Escape" && app.ui.boardOpen) {
    app.ui.boardOpen = false;
    render();
    document.querySelector<HTMLElement>(".sess-tab")?.focus();
  }
});

// ---------------- Boot ----------------

const fixtureMatch = location.hash.match(/#\/fixture\/([\w-]+)/);
if (fixtureMatch) {
  const fxParams = new URLSearchParams(location.hash.split("?")[1] ?? location.search.slice(1));
  app.fixture = true;
  app.screen = "game";
  app.isHost = fxParams.get("host") === "1"; // show host-only controls (inert in replay)
  document.documentElement.classList.add("fixture");
  startFixture(fixtureMatch[1], fxParams, {
    onState,
    onSecret,
    setSelf: (id) => (app.selfId = id),
  }).catch((e) => showError((e as Error).message));
} else {
  render();
  // Back on a classroom link with this phone's seat token — a reload, or the
  // browser threw the tab away while it sat in the background: take the seat
  // straight back instead of making them type it all again.
  if (hashJoin && app.home.name && hasSeat(app.home.code, app.home.name)) void joinLobby();
}

// The host's page IS the game: leaving it (reload, closing the tab, a stray
// swipe back) ends it for everyone, so the browser asks first.
window.addEventListener("beforeunload", (ev) => {
  if (session?.kind !== "host" || !app.state || app.state.phase === "sessionEnd") return;
  ev.preventDefault();
  ev.returnValue = "";
});
