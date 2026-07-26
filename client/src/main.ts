// App shell: session wiring, event delegation, countdown ticker, hash deep
// links (#/join/CODE). Rendering lives in ui.ts; game logic in engine.ts.
import "./style.css";
import { AVATARS, type Intent, type PublicState, type SecretState } from "../../shared/protocol";
import { createHostSession, joinAsPlayer, type HostSession, type PlayerSession } from "./net";
import { renderApp, type App } from "./ui";

const root = document.getElementById("app")!;

const app: App = {
  screen: "home",
  isHost: false,
  selfId: "",
  state: null,
  secret: { isCheater: false, correctIdx: -1 },
  error: null,
  closedReason: null,
  home: { name: "", code: "", avatar: "", busy: false },
  ui: { accuseConfirm: false, myPick: null, myVote: null, boardOpen: false },
};

let session: HostSession | PlayerSession | null = null;
let questionStartAt = 0;
let lastPhase = "";
let lastQuestionIdx = -1;
let renderPending = false;

// Deep link: /#/join/CODE pre-fills the code (spec 07).
const hashMatch = location.hash.match(/#\/join\/([A-Za-z0-9]+)/);
if (hashMatch) app.home.code = hashMatch[1].toUpperCase();
app.home.name = localStorage.getItem("hdykt-name") ?? "";
app.home.avatar = localStorage.getItem("hdykt-avatar") ?? AVATARS[Math.floor(Math.random() * AVATARS.length)];

// ---------------- Rendering ----------------

function render(): void {
  // Don't clobber a focused input (host typing a setting while joins arrive).
  const active = document.activeElement;
  if (active instanceof HTMLInputElement && root.contains(active)) {
    renderPending = true;
    return;
  }
  renderPending = false;
  root.innerHTML = renderApp(app);
  tick(); // sync countdowns immediately after a render
}

root.addEventListener("focusout", () => {
  if (renderPending) setTimeout(render, 0);
});

// ---------------- Session events ----------------

function onState(state: PublicState): void {
  const prevPhase = lastPhase;
  app.state = state;
  lastPhase = state.phase;

  if (state.phase === "question") {
    const idx = state.match?.questionIdx ?? -1;
    if (idx !== lastQuestionIdx || prevPhase !== "question") {
      lastQuestionIdx = idx;
      questionStartAt = Date.now();
      app.ui.myPick = null;
    }
  }
  if (state.phase !== prevPhase) {
    app.ui.accuseConfirm = false;
    if (state.phase === "vote") app.ui.myVote = null;
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
  app.screen = "home";
  app.state = null;
  app.closedReason = reason;
  app.home.busy = false;
  render();
}

function act(intent: Intent): void {
  if (!session) return;
  if (session.kind === "host") session.engine.localIntent(intent);
  else session.sendIntent(intent);
}

// ---------------- Actions ----------------

async function createLobby(): Promise<void> {
  const name = (document.getElementById("playerName") as HTMLInputElement).value.trim();
  if (!name) return showError("Write your name on the name tag first.");
  saveName(name);
  app.home.busy = true;
  app.error = null;
  render();
  try {
    session = await createHostSession(name, app.home.avatar, { onState, onSecret, onClosed });
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
    session = await joinAsPlayer(code, name, app.home.avatar, { onState, onSecret, onClosed });
    app.isHost = false;
    app.selfId = session.selfId;
    app.screen = "game";
    app.closedReason = null;
    location.hash = `#/join/${code}`; // rejoinable link stays in the URL bar
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

async function shareLink(url: string): Promise<void> {
  try {
    if (navigator.share) {
      await navigator.share({ title: "How Did You Know That?!", text: "Join my classroom — someone's about to cheat on the quiz.", url });
    } else {
      await navigator.clipboard.writeText(url);
      alert("Invite link copied!");
    }
  } catch {
    /* user dismissed the share sheet */
  }
}

root.addEventListener("click", (ev) => {
  const btn = (ev.target as HTMLElement).closest<HTMLElement>("[data-action]");
  if (!btn) return;
  const action = btn.dataset.action!;
  switch (action) {
    case "create":
      void createLobby();
      break;
    case "join":
      void joinLobby();
      break;
    case "share":
      void shareLink(btn.dataset.url!);
      break;
    case "pickAvatar": {
      app.home.avatar = btn.dataset.av!;
      // Preserve whatever's typed in the name field across the re-render.
      const nameInput = document.getElementById("playerName") as HTMLInputElement | null;
      if (nameInput) app.home.name = nameInput.value;
      localStorage.setItem("hdykt-avatar", app.home.avatar);
      render();
      break;
    }
    case "addBot":
      if (session?.kind === "host") session.engine.addBot();
      break;
    case "removeBot":
      if (session?.kind === "host") session.engine.removeBot(btn.dataset.id!);
      break;
    case "start":
      if (session?.kind === "host") void session.engine.startMatch();
      break;
    case "endSession":
      if (session?.kind === "host") session.engine.endSession();
      break;
    case "advance":
      if (session?.kind === "host") session.engine.advance();
      break;
    case "answer": {
      if (app.ui.myPick !== null) break; // locked on first tap
      const idx = Number(btn.dataset.idx);
      app.ui.myPick = idx;
      act({
        kind: "answer",
        questionIdx: app.state?.match?.questionIdx ?? 0,
        optionIdx: idx,
        clientElapsedMs: Date.now() - questionStartAt,
      });
      render();
      break;
    }
    case "accuse":
      // Confirmation tap required: "Burn your only token?" (spec 07)
      if (!app.ui.accuseConfirm) {
        app.ui.accuseConfirm = true;
        render();
        setTimeout(() => {
          if (app.ui.accuseConfirm) {
            app.ui.accuseConfirm = false;
            render();
          }
        }, 3500);
      } else {
        app.ui.accuseConfirm = false;
        act({ kind: "burnToken" });
      }
      break;
    case "vote": {
      const id = btn.dataset.id!;
      app.ui.myVote = id;
      act({ kind: "castVote", targetPlayerId: id });
      render();
      break;
    }
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
});

// ---------------- Countdown ticker ----------------

const ARC = 150.8; // circumference of the r=24 timer ring

function tick(): void {
  const now = Date.now();
  root.querySelectorAll<HTMLElement>("[data-count]").forEach((el) => {
    const deadline = Number(el.dataset.count);
    el.textContent = String(Math.max(0, Math.ceil((deadline - now) / 1000)));
  });
  root.querySelectorAll<SVGCircleElement>(".timer-arc").forEach((el) => {
    const deadline = Number(el.dataset.deadline);
    const total = Number(el.dataset.total);
    const remaining = Math.max(0, Math.min(total, deadline - now));
    el.style.strokeDashoffset = String(ARC * (1 - remaining / total));
    if (remaining < 5000) el.style.stroke = "var(--bad)";
  });
  // Host "Next" respects the reveal minimum (spec 01).
  root.querySelectorAll<HTMLButtonElement>("[data-min-next]").forEach((el) => {
    el.disabled = now < Number(el.dataset.minNext);
  });
}

setInterval(tick, 150);

render();
