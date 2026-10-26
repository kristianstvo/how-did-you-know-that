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
import { STUDENTS } from "./avatars";
import { clockStatus, serverNow } from "./clock";
import { startFixture } from "./fixture";
import { buzz } from "./haptics";
import { hostCue, setAfterWelcome } from "./host";
import { setSound, sfx, soundOn } from "./sound";
import {
  clearHostSave,
  createHostSession,
  hasSeat,
  joinAsPlayer,
  JoinRejectedError,
  loadHostSave,
  resumeHostSession,
  RoomGoneError,
  type HostSave,
  type HostSession,
  type NetStatus,
  type PlayerSession,
} from "./net";
import { createRenderer, reducedMotion, type Router, type TransitionKind } from "./render";
import { startHostVoice, toggleHostVoice } from "./voice";
import { closeTutorial, mountTutorialRender, playTutorial, tutorialPlaying } from "./tutorial/player";
import { myPointer } from "./screens/common";
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
import { countPeriod } from "./record";
import { cheeredAt, cheersSpent, cheerTap, syncCheers } from "./cheers";

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
  home: { name: "", code: "", avatar: "", busy: false, step: 1 },
  ui: { accuseConfirm: false, accuseTarget: null, pointMode: "point", sentPointer: null, myPick: null, voteSel: null, myVote: null, boardOpen: false, qrOpen: false, pointOpen: false, toast: null },
  fixture: false,
};

let session: HostSession | PlayerSession | null = null;
/** When ACCUSE turned into "Accuse Kiko? Tap again" — a confirm tap that comes
 *  sooner than ACCUSE_ARM_MS after it is the second half of a double-tap. */
let accuseArmedAt = 0;
const ACCUSE_ARM_MS = 450;
/** An armed ACCUSE that isn't confirmed goes back to plain ACCUSE. */
const ACCUSE_DISARM_MS = 4000;
let disarmTimer = 0;
/** v0.23: when ACCUSE opened the 👉 sheet to pick a suspect. Its Cancel sits
 *  where ACCUSE was: a tap on it sooner than ACCUSE_ARM_MS after is the same
 *  fumbled double-tap, not a change of mind. */
let pointOpenedAt = 0;
/** A ballot that was picked but never handed in goes in this long before the
 *  vote closes (the host counts at the deadline). */
const AUTO_HAND_IN_MS = 1200;
let questionShownAt = 0; // local monotonic ms when this phone first showed the question
let lastPhase = "";
let lastQuestionKey = "";

const hashJoin = location.hash.match(/#\/join\/([A-Za-z0-9]+)/);
const hashTv = location.hash.match(/#\/tv\/([A-Za-z0-9]+)/); // v0.16 big screen
if (hashJoin) app.home.code = app.home.invite = hashJoin[1].toUpperCase();
app.home.name = localStorage.getItem("hdykt-name") ?? "";
const savedAvatar = localStorage.getItem("hdykt-avatar") ?? "";
app.home.avatar = AVATARS.includes(savedAvatar) ? savedAvatar : AVATARS[Math.floor(Math.random() * AVATARS.length)];

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
      // v0.21: Next turns the page on to step 2; Change turns it back.
      const back = prevKey === "home-2" && a.home.step === 1;
      return { key: `home-${a.home.step}`, screen: home, ctx: null, transition: back ? "back" : "slide" };
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
  const added = beatKey.split(",").filter((b) => b && !prev.split(",").includes(b));
  if (app.tv) hostCue(app.state, screenKey, added, entered, settled); // v0.19: the big screen's host
  if (settled) return;
  if (screenKey.startsWith("vote-") && added.includes("in")) buzz([60, 40, 60]);
  if (screenKey.startsWith("matchEnd") && added.includes("takeover")) buzz([90, 50, 90]);
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
  if (phase === "vote" && added.includes("in")) sfx.gavel();
  if (phase === "vote" && added.includes("open")) sfx.pop(); // v0.23: the floor is over, ballots open
  if (phase === "voteResult") {
    if (added.includes("verdict")) sfx.stamp();
    if (added.includes("drop")) sfx.slide();
  }
  if (phase === "matchEnd" && added.includes("takeover") && m?.end) {
    if (m.end.reason === "cheater_threshold") sfx.siren();
    else if (m.end.reason === "cheater_banished") sfx.fanfare();
    else sfx.bell();
  }
  if (phase === "sessionEnd" && added.includes("crown")) sfx.fanfare(); // the valedictorian stamp
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
  if (app.tv && state.phase !== "lobby" && tutorialPlaying()) closeTutorial(); // the bell: class starts
  // A new match: forget last match's secret until this match's arrives, so a
  // stale "you were the cheater" can never render (it's re-sent at the bell).
  if (state.matchNumber !== lastMatchNumber) {
    // (Not on the very first state: a (re)join delivers its secret first.)
    if (lastMatchNumber !== -1 && (state.phase === "role" || state.phase === "lobby")) app.secret = { isCheater: false, correctIdx: -1 };
    lastMatchNumber = state.matchNumber;
  }
  app.state = state;
  lastPhase = state.phase;
  // v0.23: the 👉 this phone sent is pending until the host's state shows it.
  // An ACCUSE armed on your 👉 never outlives it: moved elsewhere (another tab
  // of your seat), it asks again.
  const ptr = state.players.find((p) => p.id === app.selfId)?.pointingAt ?? null;
  if (app.ui.sentPointer && ptr === app.ui.sentPointer.id) app.ui.sentPointer = null;
  else if (!app.ui.sentPointer && app.ui.accuseConfirm && ptr && ptr !== app.ui.accuseTarget) disarmAccuse();
  if (state.phase === "role") lastQuestionKey = "";
  banner();
  // Your report card (v0.12): count each finished period once, on this phone.
  if (state.phase === "matchEnd" && state.match?.end && session) countPeriod(state, app.selfId, `${state.roomCode}#${state.phaseStartedAt}`);
  syncCheers(state, !!app.tv); // v0.25: the room's tomatoes land on every screen
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
    disarmAccuse();
    app.ui.qrOpen = false;
    app.ui.pointOpen = false;
    app.ui.pointMode = "point";
    app.ui.sentPointer = null; // a 👉 the host refused (say, they went to detention) stops waiting
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
  clearHostSave();
  session = null;
  keepAwake(false);
  onNet("online");
  syncCheers(null);
  app.screen = "home";
  app.state = null;
  app.closedReason = reason;
  app.home.busy = false;
  app.home.invite = undefined; // that class is over: back to where to
  if (app.home.name.trim()) homeStep(2);
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
  const name = app.home.name.trim();
  if (!name) return needName();
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

/** v0.16: a TV or laptop shows the class's shared screen. The phone layout,
 *  scaled to the screen, with nothing to tap; it plays the sound for the room. */
async function watchTv(code: string): Promise<void> {
  app.tv = true;
  document.documentElement.classList.add("tv");
  const fit = () =>
    document.documentElement.style.setProperty("--tv-zoom", String(Math.max(1, Math.min(innerWidth / 600, innerHeight / 880)).toFixed(3)));
  fit();
  addEventListener("resize", fit);
  // Browsers only start sound after a click: say so until someone does.
  const hint = document.createElement("div");
  hint.id = "tv-sound";
  hint.textContent = "🔊 Click or press any key for sound and your host";
  document.body.append(hint);
  document.addEventListener("pointerdown", () => hint.remove(), { once: true });
  document.addEventListener("keydown", () => hint.remove(), { once: true }); // a TV remote
  // v0.19: a game-show host voices the night from here (never on a phone).
  // v0.20: once she has welcomed the room, the big screen plays how to play.
  startHostVoice();
  setAfterWelcome(tvTutorial);
  document.addEventListener("keydown", (e) => {
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === "v") toast(toggleHostVoice() ? "🎙️ Host voice on" : "🎙️ Host voice off (press V for her again)");
    if (k === "h") tvTutorial();
  });
  app.home.code = code;
  app.home.busy = true;
  render();
  try {
    session = await joinAsPlayer(code, "Big screen", "📺", { onState, onSecret, onClosed, onNet }, { watch: true });
    keepAwake(true);
    tvRoll();
    app.isHost = false;
    app.selfId = "";
    app.screen = "game";
    app.closedReason = null;
  } catch (e) {
    showError((e as Error).message);
  }
  app.home.busy = false;
  render();
}

/** v0.20: the big screen teaches the room while it joins: after the host's
 *  welcome, and again on H. Homeroom only; the bell closes it. */
function tvTutorial(): void {
  const s = app.state;
  if (!app.tv || !s || s.phase !== "lobby" || tutorialPlaying()) return;
  playTutorial({
    tv: {
      code: s.roomCode,
      url: `${location.origin}${location.pathname}#/join/${s.roomCode}`,
      who: () => (app.state?.players ?? []).map((p) => ({ face: p.avatar, name: p.name })),
    },
  });
}

/** v0.18: a TV has no thumb to scroll with. Long screens (homeroom with the
 *  rules, the period's report, graduation day) roll slowly to the bottom once
 *  their show has landed, hold, then start again from the top. */
function tvRoll(): void {
  const ROLL = new Set(["lobby", "matchEnd", "sessionEnd"]);
  const SPEED = 30; // px per second
  const CHEER_HOLD_MS = 5000; // v0.25: after the room's latest tomato
  let key = "";
  let pos = 0;
  let startAt = 0;
  let holdUntil = 0;
  let last = performance.now();
  const frame = (now: number) => {
    const dt = Math.min(100, now - last) / 1000;
    last = now;
    const s = app.state;
    const k = s && app.screen === "game" ? `${s.phase}-${s.matchNumber}` : "";
    if (k !== key) {
      key = k;
      pos = 0;
      startAt = now + 7000; // let the show land first
      holdUntil = 0;
    }
    const max = document.documentElement.scrollHeight - innerHeight;
    // v0.25: the room is pelting the cheater: hold the roll on their photo
    // (back at the top if it had rolled away) until it has been quiet a while.
    if (s?.phase === "matchEnd" && now - cheeredAt() < CHEER_HOLD_MS) {
      if (pos > 0 && (document.getElementById("me-face-real")?.getBoundingClientRect().top ?? 0) < 0) {
        pos = 0;
        window.scrollTo(0, 0);
      }
      startAt = Math.max(startAt, now);
      holdUntil = 0;
    }
    if (s && ROLL.has(s.phase) && max > 4 && now > startAt) {
      if (pos < max) {
        pos = Math.min(max, pos + SPEED * dt);
        window.scrollTo(0, Math.round(pos));
      } else if (!holdUntil) holdUntil = now + 6000;
      else if (now > holdUntil) {
        pos = 0;
        window.scrollTo(0, 0);
        startAt = now + 6000;
        holdUntil = 0;
      }
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

/** v0.14: this tab was hosting and its page reloaded (or the browser threw
 *  the tab away): take the classroom back instead of ending it for everyone. */
async function resumeHost(save: HostSave): Promise<void> {
  app.home.busy = true;
  app.home.resuming = save.code;
  render();
  // The relay holds the room for 90s after this page went away, so a flaky
  // connection is worth retrying (v0.18). Only the relay saying the room is
  // gone, or two minutes of trying, forgets the save.
  const giveUpAt = Date.now() + 120_000;
  for (;;) {
    try {
      session = await resumeHostSession(save, { onState, onSecret, onClosed, onNet });
      keepAwake(true);
      app.isHost = true;
      app.selfId = session.selfId;
      app.screen = "game";
      app.closedReason = null;
      break;
    } catch (e) {
      if (e instanceof RoomGoneError || Date.now() > giveUpAt) {
        clearHostSave();
        app.closedReason = e instanceof RoomGoneError ? e.message : "Couldn't reach the game server, so the classroom closed.";
        break;
      }
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  app.home.busy = false;
  app.home.resuming = undefined;
  render();
}

async function joinLobby(): Promise<void> {
  const code = app.home.code.trim().toUpperCase();
  const name = app.home.name.trim();
  if (!name) return needName();
  if (code.length !== 5) {
    homeStep(2); // the code box lives there
    return showError("Classroom codes are 5 characters.");
  }
  saveName(name);
  app.home.code = code;
  app.home.busy = true;
  app.error = null;
  app.home.suggest = undefined;
  render();
  const asked = app.home.avatar; // v0.24: the pick sent, even if the grid is tapped while Joining…
  try {
    session = await joinAsPlayer(code, name, asked, { onState, onSecret, onClosed, onNet, onSelf: (id) => (app.selfId = id) });
    keepAwake(true);
    app.isHost = false;
    app.selfId = session.selfId;
    app.screen = "game";
    app.closedReason = null;
    history.replaceState(null, "", `${location.pathname}${location.search}#/join/${code}`); // rejoinable link
    faceNote(code, asked);
  } catch (e) {
    if (e instanceof JoinRejectedError && e.field === "name") {
      // v0.24: a taken name is fixed on the sticker (step 1), not the code,
      // with a free one to join as in one tap (if the host offered one).
      toSticker();
      app.home.suggest = e.suggest;
    } else homeStep(2); // an invite that went stale: the code can be fixed there
    showError((e as Error).message);
  }
  app.home.busy = false;
  render();
}

/** v0.24: one face per desk. The student you picked was taken, so the host
 *  gave you another: say who you are today, once per classroom (a reload or
 *  a reconnect doesn't say it again). Your saved pick stays. */
function faceNote(code: string, asked: string): void {
  const s = app.state;
  const mine = (s?.players.find((p) => p.id === app.selfId) ?? s?.hallway?.find((h) => h.id === app.selfId))?.avatar ?? "";
  const want = STUDENTS[asked];
  const got = STUDENTS[mine];
  if (!want || !got || mine === asked) return;
  const key = `hdykt-face:${code}`;
  try {
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, "1");
  } catch {
    /* storage unavailable: say it anyway */
  }
  toast(`${want.title} was taken, so you're ${got.title.replace(/^The /, "the ")} today.`, 4000);
}

function saveName(name: string): void {
  app.home.name = name;
  localStorage.setItem("hdykt-name", name);
  localStorage.setItem("hdykt-avatar", app.home.avatar);
}

/** v0.21: the home screen's two steps. Step 2 gets its own history entry, so
 *  a phone's back gesture returns to step 1 instead of leaving the game. */
function homeStep(step: 1 | 2): void {
  if (app.screen !== "home" || app.home.step === step) return;
  if (step === 2) history.pushState({ hdyktHome: 2 }, "");
  else if (history.state?.hdyktHome === 2) {
    history.back(); // popstate (below) shows step 1
    return;
  }
  app.home.step = step;
  app.error = null;
  render();
}

window.addEventListener("popstate", () => {
  if (app.screen !== "home" || app.home.busy) return;
  const step = history.state?.hdyktHome === 2 ? 2 : 1;
  if (step === app.home.step) return;
  app.home.step = step;
  app.error = null;
  render();
});

/** Step 1's button: on to step 2, or, from an invite link, straight in. */
function homeNext(): void {
  const name = app.home.name.trim();
  if (!name) return needName();
  saveName(name);
  if (app.home.invite && app.home.code === app.home.invite) void joinLobby();
  else homeStep(2);
}

function needName(): void {
  toSticker();
  showError("Write your name on the name tag first.");
}

/** Back to step 1, where the sticker to write on is (no extra back step). */
function toSticker(): void {
  if (app.home.step !== 2) return;
  app.home.step = 1;
  if (history.state?.hdyktHome === 2) history.replaceState(null, "");
}

function showError(msg: string): void {
  app.error = msg;
  app.home.busy = false;
  render();
}

const toastEl = document.createElement("div");
toastEl.setAttribute("role", "status");
toastEl.setAttribute("aria-live", "polite");
document.body.append(toastEl);
let toastTimer = 0;
function toast(msg: string, ms = 2200): void {
  // The lobby's toast slides out of its dock, which a big screen hides.
  const inLobby = !app.tv && app.screen === "game" && app.state?.phase === "lobby";
  app.ui.toast = inLobby ? msg : null;
  toastEl.replaceChildren();
  if (!inLobby) {
    const t = document.createElement("div");
    t.className = "toast";
    t.textContent = msg;
    toastEl.append(t);
  }
  render();
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    app.ui.toast = null;
    toastEl.replaceChildren();
    render();
  }, ms);
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
    case "howto": // v0.20: the one-minute video
      playTutorial({ onClose: () => btn.isConnected && btn.focus() });
      break;
    case "share":
      void shareLink(btn.dataset.url!);
      break;
    case "pickAvatar": {
      if (!AVATARS.includes(btn.dataset.av!)) break;
      app.home.avatar = btn.dataset.av!;
      localStorage.setItem("hdykt-avatar", app.home.avatar);
      sfx.click();
      render();
      break;
    }
    case "homeNext": // v0.21: step 1 → where to
      homeNext();
      break;
    case "homeBack":
      homeStep(1);
      break;
    case "homeElsewhere": // invited, but starting a class of their own
      if (!app.home.name.trim()) needName();
      else {
        saveName(app.home.name.trim());
        homeStep(2);
      }
      break;
    case "useSuggest": // v0.24: the name was taken; join as the free one the host offered
      if (!app.home.suggest || app.home.busy) break;
      saveName(app.home.suggest);
      void joinLobby();
      break;
    case "addBot":
      host?.engine.addBot();
      break;
    case "removeBot":
    case "removePlayer":
      host?.engine.removePlayer(btn.dataset.id!);
      break;
    case "practiceRole":
      host?.engine.updateSettings({ practiceRole: btn.dataset.role as "random" | "innocent" | "cheater" });
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
      // Confirmation tap required (spec 07). v0.23: an accusation names
      // someone. The first tap arms on whoever your 👉 points at, or opens the
      // sheet to pick them; "Accuse Kiko? Tap again" sends it. A confirm tap
      // within ACCUSE_ARM_MS is a fumbled double-tap: ignored.
      if (!app.ui.accuseConfirm) {
        // The 👉 you just sent, not the last broadcast: never the suspect you left.
        const target = accusable(myPointer(app, app.state));
        if (target) armAccuse(target);
        else {
          app.ui.pointMode = "accuse";
          app.ui.pointOpen = true;
          pointOpenedAt = performance.now();
          render();
          focusSoon("#pt-sheet .pt-row");
        }
      } else if (performance.now() - accuseArmedAt >= ACCUSE_ARM_MS && app.ui.accuseTarget) {
        const targetPlayerId = app.ui.accuseTarget;
        disarmAccuse();
        buzz(40);
        act({ kind: "burnToken", targetPlayerId });
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
    case "pointSheet": {
      const accusing = app.ui.pointMode === "accuse";
      if (accusing && app.ui.pointOpen && performance.now() - pointOpenedAt < ACCUSE_ARM_MS) break; // the fumble that opened it
      app.ui.pointOpen = !app.ui.pointOpen;
      if (!app.ui.pointOpen) app.ui.pointMode = "point";
      render();
      focusSoon(app.ui.pointOpen ? "#pt-sheet .pt-row" : accusing ? "#rv-accuse" : "#rv-point");
      break;
    }
    case "point": {
      // Free and public; "" = stop pointing. v0.23: picked from ACCUSE, the
      // row also arms ACCUSE on them (the confirm tap is still to come).
      const accusing = app.ui.pointMode === "accuse";
      const id = btn.dataset.id || null;
      app.ui.pointOpen = false;
      app.ui.pointMode = "point";
      buzz(10);
      sfx.click();
      if (session) app.ui.sentPointer = { id }; // before act(): the host's own phone hears back at once
      act({ kind: "point", targetPlayerId: id });
      if (accusing && id) {
        armAccuse(id);
        focusSoon("#rv-accuse");
        break;
      }
      if (app.ui.accuseConfirm && id !== app.ui.accuseTarget) disarmAccuse(); // a new suspect: ask again
      render();
      focusSoon("#rv-point");
      break;
    }
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
      focusSoon(app.ui.qrOpen ? "#lb-qr-close" : "#lb-qr-btn");
      break;
    case "toggleBoard":
      app.ui.boardOpen = !app.ui.boardOpen;
      render();
      focusSoon(app.ui.boardOpen ? ".overlay .sheet button" : ".sess-tab");
      break;
    case "cheer": {
      // v0.25: a tomato or a round of applause for the unmasked cheater. A
      // mash waits for the host's gap (cheers.ts), so each throw clicks as it
      // leaves; only your own throws sound on a phone, the room's land in silence.
      const what = btn.dataset.what === "clap" ? "clap" : "tomato";
      const had = !cheersSpent();
      cheerTap(what, () => {
        sfx.click();
        act({ kind: "cheer", what });
      });
      // That was the last of this period's: the rail dims, and says why once.
      if (had && cheersSpent()) toast("🍅👏 All thrown for this period!");
      break;
    }
    case "home":
      clearHostSave(); // leaving on purpose: a reload must not take the room back
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
    if (app.error && input.value.trim()) app.error = null; // the sticker has a name now
    app.home.suggest = undefined; // v0.24: they're writing their own
    render();
  }
  // Keep a half-typed code in state so re-renders never wipe it.
  if (input.id === "joinCode") app.home.code = input.value.toUpperCase();
});

// Phone keyboards: "Go" on the classroom code joins. On the name, "Next"
// does what step 1's button does (an invite link's "Go" joins).
root.addEventListener("keydown", (ev) => {
  if (ev.key !== "Enter" || app.home.busy) return;
  const el = ev.target as HTMLInputElement;
  if (el.id === "joinCode") {
    ev.preventDefault();
    void joinLobby();
  } else if (el.id === "playerName") {
    ev.preventDefault();
    el.blur();
    homeNext();
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

/** Dialogs take focus when they open and give it back when they close (v0.11),
 *  so keyboards and screen readers land where the action is. */
function focusSoon(selector: string): void {
  requestAnimationFrame(() => document.querySelector<HTMLElement>(selector)?.focus({ preventScroll: true }));
}

/** v0.23: whom ACCUSE may name: a classmate in the match, not you, not in
 *  detention (the host refuses anyone else and keeps the token). */
function accusable(id: string | null): string | null {
  const p = id ? app.state?.players.find((x) => x.id === id) : undefined;
  return p && p.id !== app.selfId && !p.banished ? p.id : null;
}

/** ACCUSE asks "Accuse Kiko? Tap again", and forgets after a few seconds. */
function armAccuse(id: string): void {
  app.ui.accuseConfirm = true;
  app.ui.accuseTarget = id;
  accuseArmedAt = performance.now();
  render();
  clearTimeout(disarmTimer);
  disarmTimer = window.setTimeout(() => {
    if (!app.ui.accuseConfirm) return;
    disarmAccuse();
    render();
  }, ACCUSE_DISARM_MS);
}

function disarmAccuse(): void {
  app.ui.accuseConfirm = false;
  app.ui.accuseTarget = null;
  clearTimeout(disarmTimer);
}

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
  if (v && app.ui.voteSel && !app.ui.myVote && now >= v.deadline - AUTO_HAND_IN_MS) queueMicrotask(handIn);
  // Host "Next" respects the reveal minimum (spec 01).
  root.querySelectorAll<HTMLButtonElement>("[data-min-next]").forEach((el) => {
    const off = now < Number(el.dataset.minNext);
    if (el.disabled !== off) el.disabled = off;
  });
}

// Keyboard: Escape closes the gold-stars sheet.
document.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape" && app.ui.pointOpen) {
    const accusing = app.ui.pointMode === "accuse";
    app.ui.pointOpen = false;
    app.ui.pointMode = "point";
    render();
    document.getElementById(accusing ? "rv-accuse" : "rv-point")?.focus();
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
if (location.hash.startsWith("#/tutorial/render")) {
  mountTutorialRender(); // v0.20: tools/tutorial-video.mjs films this page frame by frame
} else if (fixtureMatch) {
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
  const hostSave = loadHostSave();
  if (hashTv) void watchTv(hashTv[1].toUpperCase());
  else if (hostSave) void resumeHost(hostSave);
  else if (hashJoin && app.home.name && hasSeat(app.home.code, app.home.name)) void joinLobby();
}

// The host's page IS the game. A reload takes the class back (v0.14), but
// closing the tab or a stray swipe back ends it for everyone once the relay
// stops holding the room, so the browser still asks first.
window.addEventListener("beforeunload", (ev) => {
  if (session?.kind !== "host" || !app.state || app.state.phase === "sessionEnd") return;
  ev.preventDefault();
  ev.returnValue = "";
});
