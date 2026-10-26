// v0.25 Tomatoes!: the room's tomatoes and applause landing on the unmasked
// cheater's yearbook photo, on every phone and on the big screen (phone-only
// rooms are the default). Layers outside #app, like the toast: a morph never
// touches them. Everything here reads the public count (end.cheers) or this
// phone's own taps, so the cheater's phone shows exactly what everyone's does.
//   #cheers      fixed, over the screen: sprites in flight, hits off the photo
//   #cheers-pin  absolute, on the photo itself: the splats ride the page scroll
// Sound: a phone hears only its own throws (main.ts clicks as each leaves); other
// people's hits land silently (v0.11: sounds wait for beats, not packets).
// The big screen thumps as each one lands, ducked under its host's voice.
import { CHEER_GAP_MS, CHEER_MAX, type PublicState } from "../../shared/protocol";
import { reducedMotion } from "./render";
import { sfx } from "./sound";

export type Cheer = "tomato" | "clap";

const FLIGHT_MS = 600;
const MAX_BURST = 6; // sprites per kind per state: a pile-up shows as a volley, not a flood
const MAX_FLYING = 16;
const MAX_DECALS = 12; // the oldest splat fades first
/** A margin over the host's gap, so jitter on the way rarely drops a tap this
 *  phone already threw. */
const TAP_GAP_MS = CHEER_GAP_MS + 80;
/** Taps that came too soon wait for the gap instead of vanishing: a mash
 *  streams ~3 throws a second. Past these two nobody can tell. */
const QUEUE_MAX = 2;
/** An own tap the count never showed (dropped on the way) stops being ours
 *  after the host's coalescing (350ms) and a round trip, so it can't hide
 *  someone else's hit for long. */
const PENDING_MS = 1200;
/** This period's own throws, across a reload: the host still counts them. */
const SAVE_KEY = "hdykt-cheers";
const GLYPH: Record<Cheer, string> = { tomato: "🍅", clap: "👏" };

let layer: HTMLElement | null = null;
let pinBox: HTMLElement | null = null;
let pin: HTMLElement | null = null;
let key = ""; // this period's report card; "" = not on one
let isTv = false;
let seen: Record<Cheer, number> = { tomato: 0, clap: 0 };
let pending: Record<Cheer, number[]> = { tomato: [], clap: [] };
let lastTap = -Infinity;
let taps = 0;
let queue: { what: Cheer; send: () => void }[] = [];
let drain: ReturnType<typeof setTimeout> | undefined;
let roomAt = -Infinity; // when someone else's latest hit arrived
const flyers = new Set<HTMLElement>();
const decals: HTMLElement[] = [];

/** Each layer carries a 100px probe: the TV scales the page with CSS zoom, so
 *  screen pixels → layer pixels is measured, not assumed. */
function makeLayer(id: string): HTMLElement {
  const el = document.createElement("div");
  el.id = id;
  el.setAttribute("aria-hidden", "true");
  const probe = document.createElement("i");
  probe.className = "ch-probe";
  el.append(probe);
  document.body.append(el);
  return el;
}

function layers(): { layer: HTMLElement; pin: HTMLElement } {
  if (!layer) {
    layer = makeLayer("cheers");
    pinBox = makeLayer("cheers-pin");
    pin = document.createElement("div");
    pin.className = "ch-pin";
    pinBox.append(pin);
    addEventListener("resize", placePin);
  }
  return { layer, pin: pin! };
}

/** Screen point → a layer's own CSS pixels. */
function local(el: HTMLElement): (x: number, y: number) => { x: number; y: number } {
  const r = el.querySelector(".ch-probe")!.getBoundingClientRect();
  const k = r.width / 100 || 1;
  return (x, y) => ({ x: (x - r.left) / k, y: (y - r.top) / k });
}

const photo = () => document.getElementById("me-face-real");

/** The pin sits on the photo in page coordinates, so its splats scroll with it. */
function placePin(): void {
  const face = photo();
  if (!pinBox || !pin || !face) return;
  const r = face.getBoundingClientRect();
  const to = local(pinBox);
  const a = to(r.left, r.top);
  const b = to(r.right, r.bottom);
  pin.style.transform = `translate(${a.x}px, ${a.y}px)`;
  pin.style.width = `${b.x - a.x}px`;
  pin.style.height = `${b.y - a.y}px`;
}

function clear(): void {
  clearTimeout(drain); // a queued throw never lands on the next screen
  drain = undefined;
  queue = [];
  for (const el of flyers) el.remove();
  flyers.clear();
  decals.length = 0;
  pin?.replaceChildren();
  layer?.querySelectorAll(":scope > :not(.ch-probe)").forEach((el) => el.remove());
}

/** Somewhere just off a screen edge, mostly below and to the sides: the room
 *  throws from its seats. */
function edge(w: number, h: number): { x: number; y: number } {
  const r = Math.random();
  if (r < 0.5) return { x: Math.random() * w, y: h + 30 };
  if (r < 0.72) return { x: -30, y: h * (0.35 + Math.random() * 0.65) };
  if (r < 0.94) return { x: w + 30, y: h * (0.35 + Math.random() * 0.65) };
  return { x: Math.random() * w, y: -30 };
}

/** One tomato or clap: from `from` (this phone's own button) or a random edge
 *  to the photo, then a splat on it or a 👏 pop. Scrolled away from the photo,
 *  it lands on the count instead. Reduced motion: it just appears there. */
function hit(what: Cheer, from: DOMRect | null): void {
  const { layer: l, pin: p } = layers();
  if (flyers.size >= MAX_FLYING) return;
  const k = key;
  const to = local(l);
  const view = l.getBoundingClientRect();
  const size = to(view.right, view.bottom);
  const face = photo()?.getBoundingClientRect();
  const onFace = !!face && face.width > 0 && face.bottom > view.top && face.top < view.bottom;
  // Where on the photo (a fraction of it), so the splat stays put when the page scrolls.
  const fx = 0.5 + (Math.random() - 0.5) * 0.7;
  const fy = 0.5 + (Math.random() - 0.5) * 0.7;
  const chip = document.getElementById("me-cheer-count")?.getBoundingClientRect();
  const end = onFace
    ? to(face!.left + face!.width * fx, face!.top + face!.height * fy)
    : chip && chip.width
      ? to(chip.left + chip.width / 2, chip.top + chip.height / 2)
      : { x: size.x / 2, y: size.y / 2 };
  const land = () => {
    if (k !== key) return; // the class moved on mid-flight
    if (isTv) (what === "tomato" ? sfx.splat : sfx.clap)();
    const mark = document.createElement("i");
    if (onFace) {
      placePin();
      mark.style.left = `${(fx * 100).toFixed(1)}%`;
      mark.style.top = `${(fy * 100).toFixed(1)}%`;
      p.append(mark);
    } else {
      mark.style.left = `${end.x}px`;
      mark.style.top = `${end.y}px`;
      l.append(mark);
    }
    if (what === "tomato" && onFace) {
      mark.className = "ch-splat";
      mark.style.setProperty("--r", `${Math.round(Math.random() * 360)}deg`);
      mark.style.setProperty("--s", (0.75 + Math.random() * 0.45).toFixed(2));
      decals.push(mark);
      if (decals.length > MAX_DECALS) {
        const old = decals.shift()!;
        old.classList.add("gone");
        setTimeout(() => old.remove(), 700);
      }
    } else {
      mark.className = "ch-pop";
      mark.textContent = GLYPH[what];
      setTimeout(() => mark.remove(), 950);
    }
  };
  if (reducedMotion()) {
    land();
    return;
  }
  const start = from ? to(from.left + from.width / 2, from.top + from.height / 2) : edge(size.x, size.y);
  const peak = { x: (start.x + end.x) / 2, y: Math.min(start.y, end.y) - 50 - Math.random() * 70 };
  const spin = (Math.random() < 0.5 ? -1 : 1) * (220 + Math.random() * 280);
  const el = document.createElement("i");
  el.className = "ch-fly";
  el.textContent = GLYPH[what];
  l.append(el);
  flyers.add(el);
  // A throw: up and over, then down onto the photo (transform only).
  const anim = el.animate(
    [
      { transform: `translate(${start.x}px, ${start.y}px) rotate(0deg) scale(1.2)`, easing: "cubic-bezier(0.25, 0.6, 0.45, 1)" },
      { transform: `translate(${peak.x}px, ${peak.y}px) rotate(${spin / 2}deg) scale(1)`, offset: 0.5, easing: "cubic-bezier(0.55, 0, 0.75, 0.4)" },
      { transform: `translate(${end.x}px, ${end.y}px) rotate(${spin}deg) scale(0.8)` },
    ],
    { duration: FLIGHT_MS, fill: "forwards" },
  );
  anim.onfinish = () => {
    el.remove();
    if (flyers.delete(el)) land();
  };
}

/** Every state: on a new report card take the count as it stands (a reload
 *  or a late arrival doesn't replay old tomatoes); afterwards each rise
 *  throws what this phone didn't throw itself. Off the report card: clear. */
export function syncCheers(s: PublicState | null, tv = false): void {
  isTv = tv;
  const end = s?.phase === "matchEnd" ? s.match?.end : null;
  const k = s && end ? `${s.roomCode}#${s.matchNumber}#${s.phaseStartedAt}` : "";
  const count = { tomato: end?.cheers?.tomato ?? 0, clap: end?.cheers?.clap ?? 0 };
  if (k !== key) {
    key = k;
    clear();
    seen = count;
    pending = { tomato: [], clap: [] };
    lastTap = -Infinity;
    taps = k ? savedTaps(k) : 0;
    roomAt = -Infinity;
    return;
  }
  if (!k) return;
  const t = performance.now();
  for (const what of ["tomato", "clap"] as const) {
    const delta = count[what] - seen[what];
    seen[what] = count[what];
    if (delta <= 0) continue;
    const mine = pending[what].filter((at) => t - at < PENDING_MS);
    const own = Math.min(delta, mine.length);
    pending[what] = mine.slice(own);
    if (delta > own) roomAt = t;
    // Each waits at least a frame: the big screen may roll the photo back into view first (main.ts tvRoll).
    for (let i = 0; i < Math.min(delta - own, MAX_BURST); i++) {
      setTimeout(() => k === key && hit(what, null), 40 + i * 90 + Math.random() * 120);
    }
  }
}

function savedTaps(k: string): number {
  try {
    const saved = JSON.parse(sessionStorage.getItem(SAVE_KEY) ?? "null") as { key: string; taps: number } | null;
    return saved?.key === k ? Math.min(CHEER_MAX, saved.taps) : 0;
  } catch {
    return 0;
  }
}

/** One throw, now: the sprite leaves its button and `send` tells the host. */
function throwNow(what: Cheer, send: () => void): void {
  lastTap = performance.now();
  taps++;
  pending[what].push(lastTap);
  try {
    sessionStorage.setItem(SAVE_KEY, JSON.stringify({ key, taps }));
  } catch {
    // Private mode: a reload just forgets this period's throws.
  }
  // The button as it is now: a morph may have replaced the one that was tapped.
  hit(what, document.getElementById(what === "tomato" ? "me-tomato" : "me-clap")?.getBoundingClientRect() ?? null);
  send();
}

function flush(): void {
  drain = undefined;
  const next = queue.shift();
  if (!next) return;
  throwNow(next.what, next.send);
  if (queue.length) drain = setTimeout(flush, TAP_GAP_MS);
}

/** This phone's own tap. Within the host's rate caps it throws one right away;
 *  a tap that comes too soon waits for the gap (up to QUEUE_MAX of them), so a
 *  mash streams at the host's pace instead of losing taps. Each throw `send`s
 *  itself as it leaves. */
export function cheerTap(what: Cheer, send: () => void): void {
  if (!key || cheersSpent()) return;
  const wait = lastTap + TAP_GAP_MS - performance.now();
  if (!queue.length && wait <= 0) return throwNow(what, send);
  if (queue.length >= QUEUE_MAX) return;
  queue.push({ what, send });
  drain ??= setTimeout(flush, Math.max(0, wait));
}

/** v0.25: this phone has thrown (or queued) all CHEER_MAX of this period's
 *  cheers: the rail dims its buttons. */
export const cheersSpent = (): boolean => !!key && taps + queue.length >= CHEER_MAX;

/** When someone else's latest hit arrived: the big screen holds its roll on
 *  the photo while the room is throwing. */
export const cheeredAt = (): number => roomAt;
