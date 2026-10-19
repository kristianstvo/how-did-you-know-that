// Fixture replay: plays a recorded, seeded match (sim/tape.ts) without any
// network, from any player's point of view, with a scrubber. Any reveal can be
// reproduced exactly — and the parity/perf tests drive it.
//   #/fixture/<name>?as=cheater|innocent|<name>&t=<ms>&paused=1&speed=1&ui=0
import type { PublicState, SecretState } from "../../shared/protocol";
import { setClockOverride } from "./clock";

export interface Tape {
  name: string;
  description: string;
  seed: number;
  t0: number; // tape clock at playhead 0
  durationMs: number;
  cheaterId: string;
  players: { id: string; name: string }[];
  frames: { t: number; state: PublicState }[];
  secrets: { t: number; playerId: string; secret: SecretState }[];
}

interface Hooks {
  onState(s: PublicState): void;
  onSecret(s: SecretState): void;
  setSelf(id: string): void;
}

declare global {
  interface Window {
    __fixture?: {
      seek(ms: number): void;
      pause(): void;
      play(): void;
      playhead(): number;
      duration: number;
      phases: { t: number; label: string }[];
      viewpoint: string;
    };
  }
}

export async function startFixture(name: string, params: URLSearchParams, hooks: Hooks): Promise<void> {
  const res = await fetch(`${import.meta.env.BASE_URL}fixtures/${encodeURIComponent(name)}.json`);
  if (!res.ok) throw new Error(`Fixture "${name}" not found`);
  const tape = (await res.json()) as Tape;

  const as = params.get("as") ?? "innocent";
  const viewer =
    as === "cheater"
      ? tape.players.find((p) => p.id === tape.cheaterId)!
      : as === "innocent"
        ? tape.players.find((p) => p.id !== tape.cheaterId)!
        : (tape.players.find((p) => p.name.toLowerCase() === as.toLowerCase()) ?? tape.players[0]);
  hooks.setSelf(viewer.id);
  // mask=1: the same seat with its secret withheld — the counterfactual "what
  // this phone would show if it were innocent". The parity test diffs the two.
  const mask = params.get("mask") === "1";
  const mySecrets = tape.secrets
    .filter((x) => x.playerId === viewer.id)
    .map((x) => (mask ? { ...x, secret: { isCheater: false, correctIdx: -1 } } : x));

  let speed = Number(params.get("speed") ?? 1) || 1;
  let paused = params.get("paused") === "1";
  // Lobby frames sit before playhead 0 (role screen = 0), so ?t=-1500 shows
  // the lobby and every recorded playhead time stays valid.
  const minHead = Math.min(0, tape.frames[0].t - tape.t0);
  const clamp = (ms: number) => Math.max(minHead, Math.min(tape.durationMs, ms));
  let playhead = clamp(params.has("t") ? Number(params.get("t")) || 0 : minHead);
  let anchorReal = performance.now();
  let anchorHead = playhead;
  const currentHead = () => (paused ? playhead : Math.min(tape.durationMs, anchorHead + (performance.now() - anchorReal) * speed));
  setClockOverride(() => tape.t0 + currentHead());

  let lastFrame = -1;
  let lastSecret = -1;
  const latest = <T extends { t: number }>(list: T[], t: number) => {
    let lo = -1;
    for (let i = 0; i < list.length && list[i].t <= t; i++) lo = i;
    return lo;
  };
  mySecrets.sort((a, b) => a.t - b.t);
  const sync = () => {
    playhead = currentHead();
    const t = tape.t0 + playhead;
    const si = latest(mySecrets, t);
    if (si !== lastSecret && si >= 0) {
      lastSecret = si;
      hooks.onSecret(mySecrets[si].secret);
    }
    const fi = latest(tape.frames, t);
    if (fi !== lastFrame && fi >= 0) {
      lastFrame = fi;
      hooks.onState(tape.frames[fi].state);
    }
    updateUi();
    requestAnimationFrame(sync);
  };

  const phases: { t: number; label: string }[] = [];
  let prevKey = "";
  for (const f of tape.frames) {
    const m = f.state.match;
    const key = `${f.state.phase}:${m?.questionIdx ?? ""}`;
    if (key !== prevKey) phases.push({ t: f.t - tape.t0, label: `${f.state.phase}${m && f.state.phase !== "role" ? ` Q${m.questionIdx + 1}` : ""}` });
    prevKey = key;
  }

  const seek = (ms: number) => {
    playhead = clamp(ms);
    anchorHead = playhead;
    anchorReal = performance.now();
    lastFrame = -1;
    lastSecret = -1;
  };
  window.__fixture = {
    seek,
    pause: () => {
      playhead = currentHead();
      paused = true;
    },
    play: () => {
      anchorHead = playhead;
      anchorReal = performance.now();
      paused = false;
    },
    playhead: () => currentHead(),
    duration: tape.durationMs,
    phases,
    viewpoint: as === "cheater" ? "cheater" : "innocent",
  };

  // Scrubber (outside #app so morphing never touches it).
  const showUi = params.get("ui") !== "0";
  const bar = document.createElement("div");
  bar.id = "scrubber";
  bar.innerHTML = `
    <button data-s="play" aria-label="Play or pause">⏯</button>
    <button data-s="prev" aria-label="Previous phase">⏮</button>
    <button data-s="next" aria-label="Next phase">⏭</button>
    <select data-s="speed" aria-label="Speed">${[0.1, 0.25, 0.5, 1, 2].map((v) => `<option value="${v}" ${v === speed ? "selected" : ""}>${v}×</option>`).join("")}</select>
    <input data-s="range" type="range" min="${minHead}" max="${tape.durationMs}" step="10" value="${playhead}" aria-label="Playhead" />
    <span data-s="readout"></span>
    <span class="fx-note">replay · ${tape.name} · viewing as ${viewer.name}${viewer.id === tape.cheaterId ? " (cheater)" : ""}</span>`;
  if (showUi) document.body.appendChild(bar);
  const range = bar.querySelector<HTMLInputElement>('[data-s="range"]')!;
  const readout = bar.querySelector<HTMLElement>('[data-s="readout"]')!;
  const updateUi = () => {
    if (!showUi) return;
    if (document.activeElement !== range) range.value = String(Math.round(playhead));
    const phase = [...phases].reverse().find((p) => p.t <= playhead);
    readout.textContent = `${(playhead / 1000).toFixed(2)}s · ${phase?.label ?? ""}${paused ? " · paused" : ""}`;
  };
  bar.addEventListener("click", (e) => {
    const s = (e.target as HTMLElement).closest<HTMLElement>("[data-s]")?.dataset.s;
    if (s === "play") (paused ? window.__fixture!.play : window.__fixture!.pause)();
    if (s === "prev") seek([...phases].reverse().find((p) => p.t < playhead - 300)?.t ?? 0);
    if (s === "next") seek(phases.find((p) => p.t > playhead + 1)?.t ?? playhead);
  });
  bar.addEventListener("input", (e) => {
    const el = e.target as HTMLInputElement;
    if (el.dataset.s === "range") seek(Number(el.value));
    if (el.dataset.s === "speed") {
      playhead = currentHead();
      anchorHead = playhead;
      anchorReal = performance.now();
      speed = Number(el.value);
    }
  });
  requestAnimationFrame(sync);
}
