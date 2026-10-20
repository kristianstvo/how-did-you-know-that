// The tutorial's storyboard (v0.20): nine scenes on a 1080×1920 stage, one
// per narration line (narration.ts). Each scene builds its elements once, then
// poses them as a pure function of its own clock t (ms since the scene began).
// Cues come from the words Amy says: c.at("dot") is the moment she starts
// saying "dot". Nothing here reads a real game: it's a staged class of five,
// with Priya (🧪) as the cheater. Strings are fixed copy, never user input.
import { face } from "../avatars";
import { gone, inOut, kf, lerp, linear, out, p, pose, POP, RISE, SLAP, STAMP } from "./anim";

export type SfxName = "bell" | "pop" | "tick" | "whistle" | "slaps" | "drumroll" | "sting" | "stamp" | "gavel" | "slide" | "siren" | "fanfare" | "click";
export type SfxCue = [at: number, name: SfxName, ...args: number[]];

export interface Cues {
  /** When she starts saying `word` (its nth time in this line): ms on the scene clock. */
  at(word: string, nth?: number): number;
  /** When she finishes saying it. */
  end(word: string, nth?: number): number;
}
export interface Scene {
  root: HTMLElement;
  update(t: number): void;
}
export interface SceneDef {
  clip: string; // narration.ts id
  lead: number; // ms of picture before she speaks
  tail: number; // ms of picture after she stops
  sfx(c: Cues): SfxCue[];
  build(c: Cues): Scene;
}

// ---------------- Building blocks ----------------

function E(cls: string, html: string, x: number, y: number, w?: number, h?: number): HTMLElement {
  const e = document.createElement("div");
  e.className = `tut-a ${cls}`;
  e.innerHTML = html;
  e.style.left = `${x}px`;
  e.style.top = `${y}px`;
  if (w !== undefined) {
    e.style.width = `${w}px`;
    e.style.setProperty("--w", `${w}px`);
  }
  if (h !== undefined) e.style.height = `${h}px`;
  return e;
}

/** A stamp centred across the stage, sized to its words (any number of lines). */
function centred(cls: string, html: string, y: number): HTMLElement {
  return E("tut-centre", `<span class="tut-stamp ${cls}">${html}</span>`, 0, y, 1080);
}

function scene(...kids: HTMLElement[]): HTMLElement {
  const g = document.createElement("div");
  g.className = "tut-scene";
  g.append(...kids);
  return g;
}

/** Chalk writing: reveal left to right as k goes 0 → 1. */
function write(el: HTMLElement, k: number): void {
  el.style.clipPath = k >= 1 ? "" : `inset(-40% ${((1 - k) * 100).toFixed(2)}% -40% -8%)`;
  el.style.visibility = k <= 0 ? "hidden" : "";
}

/** The game's hand-drawn chalk circle (vote.ts), drawn on as k goes 0 → 1. */
const RING = `<svg viewBox="0 0 100 60" preserveAspectRatio="none"><path pathLength="100" d="M54 4 C82 3 98 15 97 31 C96 49 73 57 48 57 C21 57 3 47 3 30 C3 14 23 5 47 5 C60 4 70 6 78 9"/></svg>`;
function ring(cx: number, cy: number, w: number, h: number): { el: HTMLElement; draw(k: number): void } {
  const el = E("tut-ring", RING, cx - w / 2, cy - h / 2, w, h);
  const path = el.querySelector("path")!;
  return {
    el,
    draw(k) {
      path.style.strokeDashoffset = (100 * (1 - k)).toFixed(2);
      el.style.visibility = k <= 0 ? "hidden" : "";
    },
  };
}

/** Deterministic noise in 0..1, so confetti is identical in every render. */
const noise = (k: number) => {
  const x = Math.sin(k * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
};
const CONFETTI_COLORS = ["#ffd166", "#8ee59a", "#7cc4ff", "#ff6b6b", "#f4f1e8"];
function confetti(n: number, ox: number, oy: number): { el: HTMLElement; burst(t: number, t0: number): void } {
  const el = E("tut-confetti", "", 0, 0, 1080, 1920);
  const bits = Array.from({ length: n }, (_, i) => {
    const b = document.createElement("i");
    b.style.background = CONFETTI_COLORS[i % CONFETTI_COLORS.length];
    if (i % 3 === 1) b.style.borderRadius = "50%";
    el.append(b);
    const ang = -Math.PI / 2 + (noise(i) - 0.5) * 2.4;
    const v = 900 + noise(i + 31) * 900;
    return { b, vx: Math.cos(ang) * v, vy: Math.sin(ang) * v, spin: (noise(i + 57) - 0.5) * 1400 };
  });
  return {
    el,
    burst(t, t0) {
      const s = (t - t0) / 1000;
      el.style.visibility = s < 0 || s > 2.6 ? "hidden" : "";
      if (s < 0 || s > 2.6) return;
      for (const { b, vx, vy, spin } of bits) {
        const x = ox + vx * s * 0.8;
        const y = oy + vy * s * 0.8 + 0.5 * 2600 * s * s;
        b.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) rotate(${(spin * s).toFixed(1)}deg)`;
        b.style.opacity = s > 1.8 ? (1 - (s - 1.8) / 0.8).toFixed(3) : "1";
      }
    },
  };
}

/** A gentle wobble around the resting angle (a stamp settling, a bell). */
const swing = (t: number, t0: number, amp: number, period = 95, decay = 700) =>
  t < t0 ? 0 : Math.sin((t - t0) / period) * amp * Math.exp(-(t - t0) / decay);

// ---------------- The staged class ----------------

const CLASS = [
  ["🎒", "Kiko"],
  ["📚", "Maya"],
  ["✏️", "Sam"],
  ["🧪", "Priya"],
  ["📐", "Ana"],
] as const;
const PRIYA = 3;
const ROW_X = (i: number) => 140 + i * 200; // avatar centres in a row of five

/** The staged class's portraits (v0.21: the game's students). */
export const CLASS_FACES = CLASS.map(([a]) => a);

function av(i: number, cx: number, cy: number, size = 130, name = true): HTMLElement {
  const [a, nm] = CLASS[i];
  const e = E("tut-av", `<span class="tut-face">${face(a)}</span>${name ? `<span class="tut-name">${nm}</span>` : ""}`, cx - size / 2, cy - size / 2, size, size);
  e.style.setProperty("--sz", `${size}px`);
  return e;
}

const Q = { text: "Which planet is called the Red Planet?", opts: ["Venus", "Mars", "Jupiter", "Saturn"], right: 1 };
const OPT_TOP = (i: number) => 450 + i * 95; // inside the phone's screen
/** The question screen on a phone, 520×880. Option rows sit at screen
 *  x 24..464 (the screen is inset 16px in the phone). */
function phone(x: number, y: number, cheater = false): { el: HTMLElement; opts: HTMLElement[]; dot: HTMLElement | null } {
  const el = E("tut-phone", "", x, y, 520, 880);
  const scr = document.createElement("div");
  scr.className = "tut-scr";
  scr.innerHTML = `
    <div class="tut-ph-head"><span><b>Q1</b>/10</span><span class="tut-pill">POP QUIZ</span></div>
    <div class="tut-ph-subj"><span class="e">🔭</span><span class="s"><small>SUBJECT</small><b>Astronomy</b></span><span class="pts">100<small>PTS</small></span></div>
    <div class="tut-ph-bar"><i></i></div>
    <div class="tut-ph-q">${Q.text}</div>`;
  const opts = Q.opts.map((o, i) => {
    const r = document.createElement("div");
    r.className = "tut-opt";
    r.style.top = `${OPT_TOP(i)}px`;
    r.innerHTML = `<span class="l">${"ABCD"[i]}</span><span class="t">${o}</span>`;
    scr.append(r);
    return r;
  });
  let dot: HTMLElement | null = null;
  if (cheater) {
    dot = document.createElement("i");
    dot.className = "tut-dot";
    opts[Q.right].append(dot);
  }
  el.append(scr);
  return { el, opts, dot };
}
/** Stage centre of option i on a phone placed at (x, y). */
const optCentre = (x: number, y: number, i: number) => ({ x: x + 16 + 244, y: y + 16 + OPT_TOP(i) + 40 });

// ---------------- 1 · Title ----------------

const title: SceneDef = {
  clip: "n1",
  lead: 700,
  tail: 500,
  sfx: (c) => [[180, "bell"], [c.at("Here's") + 60, "stamp"]],
  build(c) {
    const bell = E("tut-emoji tut-bell", "🔔", 440, 300, 200, 200);
    const l1 = E("tut-title t1", "How Did You", 0, 590, 1080);
    const l2 = E("tut-title t2", "Know That?!", 0, 735, 1080);
    const tag = E("tut-paper tut-tag", "📝 How to play", 250, 1020, 580);
    return {
      root: scene(bell, l1, l2, tag),
      update(t) {
        const drop = kf(t, 0, 520, [[0, { y: -460, o: 0 }], [0.72, { y: 24, o: 1 }], [1, { y: 0, o: 1 }]]);
        pose(bell, { ...drop, r: swing(t, 180, 24, 90, 800) });
        write(l1, p(t, c.at("How"), c.end("You") - c.at("How") + 140, linear));
        write(l2, p(t, c.at("Know"), c.end("That!") - c.at("Know") + 60, linear));
        pose(tag, kf(t, c.at("Here's"), 380, SLAP));
      },
    };
  },
};

// ---------------- 2 · A pop quiz on every phone ----------------

const PX = 280; // the phone, scenes 2 and 3
const PY = 420;

const quiz: SceneDef = {
  clip: "n2",
  lead: 300,
  tail: 450,
  sfx: (c) => [
    [c.at("pop"), "stamp"],
    [c.at("Ten"), "pop"],
    ...CLASS.map((_, i): [number, SfxName] => [c.at("answers") + i * 150, "click"]),
    [c.at("phone.") - 60, "stamp"],
  ],
  build(c) {
    const avs = CLASS.map((_, i) => av(i, ROW_X(i), 300, 120));
    const ticks = CLASS.map((_, i) => E("tut-check", "✓", ROW_X(i) + 26, 300 + 22, 52, 52));
    const ph = phone(PX, PY);
    const stamp = E("tut-stamp red", "Pop quiz!", 590, 440);
    const sticky = E("tut-sticky", "10<small>questions</small>", 36, 700, 230, 220);
    const b = optCentre(PX, PY, Q.right);
    const finger = E("tut-emoji tut-finger", "👆", b.x - 30, b.y - 10, 120, 120);
    const locked = E("tut-stamp green small", "Locked in", b.x + 10, b.y - 70);
    return {
      root: scene(ph.el, ...avs, ...ticks, stamp, sticky, finger, locked),
      update(t) {
        avs.forEach((a, i) => pose(a, kf(t, 120 + i * 90, 420, POP)));
        pose(ph.el, kf(t, 0, 520, [[0, { y: 420, o: 0 }], [1, { y: 0, o: 1 }]]));
        pose(stamp, kf(t, c.at("pop"), 330, STAMP), gone(t, c.at("everyone"), 300));
        pose(sticky, { ...kf(t, c.at("Ten"), 420, POP), r: -6 });
        ticks.forEach((k, i) => pose(k, kf(t, c.at("answers") + i * 150, 320, POP)));
        // Your own phone: a thumb taps B, and it locks in.
        const tap = c.at("phone.") - 60;
        const reach = kf(t, tap - 520, 520, [[0, { x: 200, y: 260, o: 0 }], [0.5, { x: 60, y: 90, o: 1 }], [1, { x: 0, y: 0, o: 1 }]], inOut);
        const press = t > tap && t < tap + 160 ? 0.88 : 1;
        pose(finger, { ...reach, s: press }, gone(t, tap + 500, 250));
        ph.opts[Q.right].classList.toggle("picked", t >= tap);
        pose(locked, kf(t, tap + 40, 320, STAMP));
      },
    };
  },
};

// ---------------- 3 · One of you is the cheater (the dot) ----------------

const cheater: SceneDef = {
  clip: "n3",
  lead: 300,
  tail: 650,
  sfx: (c) => [[c.at("one"), "drumroll", 900], [c.at("cheater…"), "pop"], [c.at("dot"), "sting"]],
  build(c) {
    const avs = CLASS.map((_, i) => av(i, ROW_X(i), 300, 120));
    const spot = E("tut-spot", "", 0, 0, 1080, 1920);
    const note = E("tut-paper tut-note", `<small>📝 Psst… your note</small><b>It's you. Find the dot. 🤫</b>`, 150, 470, 780);
    const ph = phone(PX, PY, true);
    const label = E("tut-chalk yellow tut-dot-label", "the right<br>answer →", 18, 925, 280);
    // The magnifier, centred on the dot (top-right corner of option B).
    const dx = PX + 16 + 24 + 440 - 3 - 14 - 4.5;
    const dy = PY + 16 + OPT_TOP(Q.right) + 3 + 12 + 4.5;
    const lens = E(
      "tut-lens",
      `<div class="tut-lens-in"><div class="tut-zopt" style="left:${150 - 1264}px;top:${150 - 48}px"><i class="tut-zdot"></i></div></div><span class="tut-lens-handle"></span>`,
      dx - 150,
      dy - 150,
      300,
      300,
    );
    const zdot = lens.querySelector<HTMLElement>(".tut-zdot")!;
    return {
      root: scene(avs[0], avs[1], avs[2], avs[4], spot, avs[PRIYA], note, ph.el, label, lens),
      update(t) {
        const out1 = gone(t, c.at("their") - 150, 350);
        avs.forEach((a, i) => pose(a, { o: i === PRIYA ? 1 : lerp(1, 0.35, p(t, c.at("secretly"), 300)), s: i === PRIYA ? lerp(1, 1.18, p(t, c.at("secretly"), 300)) : 1 }, out1));
        // The spotlight sweeps the row and stops on Priya.
        const k1 = p(t, c.at("one"), 650, inOut);
        const k2 = p(t, c.at("one") + 650, c.at("secretly") - c.at("one") - 450, inOut);
        const sx = k2 > 0 ? lerp(ROW_X(4), ROW_X(PRIYA), k2) : lerp(ROW_X(0), ROW_X(4), k1);
        spot.style.background = `radial-gradient(circle 230px at ${sx.toFixed(1)}px 300px, rgba(5,10,7,0) 0, rgba(5,10,7,0) 120px, rgba(5,10,7,0.78) 230px)`;
        pose(spot, { o: p(t, c.at("one") - 200, 300) }, out1);
        pose(note, kf(t, c.at("cheater…"), 450, RISE), out1);
        // Her phone: the question, with a tiny dot on the right answer.
        pose(ph.el, kf(t, c.at("their") - 100, 520, [[0, { y: 380, o: 0 }], [1, { y: 0, o: 1 }]]));
        pose(lens, kf(t, c.at("tiny") - 120, 420, [[0, { s: 0.25, o: 0, r: -20 }], [0.7, { s: 1.08, o: 1, r: 4 }], [1, { s: 1, o: 1, r: 0 }]]));
        const beat = p(t, c.at("dot"), 260) - p(t, c.at("dot") + 260, 420, inOut);
        pose(zdot, { s: 1 + beat * 0.7 });
        pose(label, kf(t, c.at("right"), 400, RISE));
      },
    };
  },
};

// ---------------- 4 · The graduation line ----------------

const START = [300, 500, 400, 600, 300];
const MID = [700, 1000, 800, 1100, 600];
const LATE = [900, 1300, 1100, 2300, 800];
const SCALE = 2400; // the bar's full width in points
const TRACK_X = 380;
const TRACK_W = 440;
const LINE_X = TRACK_X + (TRACK_W * 2100) / SCALE;

const line: SceneDef = {
  clip: "n4",
  lead: 300,
  tail: 700,
  sfx: (c) => [[c.at("graduation"), "pop"], [c.at("graduate…"), "siren"]],
  build(c) {
    const panel = E("tut-panel", `<div class="tut-gb-head"><span>📒 Grade book</span><b>🎓 line 2100</b></div>`, 60, 260, 960, 900);
    const rows = CLASS.map((_, i) => {
      const y = 400 + i * 150;
      const r = E("tut-gb-row", `<span class="tut-gb-name">${CLASS[i][1]}</span><span class="tut-gb-track"><i></i></span><b class="tut-gb-score">0</b>`, 60, y, 960, 110);
      r.prepend(av(i, 95, 55, 96, false));
      return r;
    });
    const fills = rows.map((r) => r.querySelector<HTMLElement>(".tut-gb-track i")!);
    const scores = rows.map((r) => r.querySelector<HTMLElement>(".tut-gb-score")!);
    const lineEl = E("tut-gradline", "", LINE_X, 380, 8, 760);
    const lineTag = E("tut-pill big yellow", "🎓 Graduation line", LINE_X - 235, 1135, 470);
    const cap = E("tut-emoji", "🎓", 60 + 95 - 50, 400 + PRIYA * 150 - 62, 100, 100);
    const alarm = E("tut-alarm", "", 0, 0, 1080, 1920);
    const stamp = centred("red", "🚨 The cheater<br>graduated!", 1165);
    return {
      root: scene(panel, ...rows, lineEl, lineTag, cap, alarm, stamp),
      update(t) {
        pose(panel, kf(t, 0, 450, RISE));
        rows.forEach((r, i) => pose(r, kf(t, 80 + i * 70, 400, RISE)));
        const grad = c.at("graduate…");
        const k1 = p(t, 300, c.at("reaches") - 300, inOut);
        const k2 = p(t, c.at("reaches"), grad - c.at("reaches") + 250, inOut);
        rows.forEach((r, i) => {
          const v = i === PRIYA ? lerp(lerp(START[i], MID[i], k1), LATE[i], k2) : lerp(lerp(START[i], MID[i], k1), LATE[i], p(t, c.at("reaches"), 2600, inOut));
          fills[i].style.width = `${Math.min(100, (v / SCALE) * 100).toFixed(2)}%`;
          scores[i].textContent = String(Math.round(v / 100) * 100);
          // The class loses: everyone else slumps.
          const slump = i === PRIYA ? 0 : p(t, c.at("class"), 500);
          r.style.filter = slump > 0 ? `grayscale(${slump.toFixed(2)})` : "";
          if (t >= 80 + i * 70 + 400) pose(r, { o: lerp(1, 0.45, slump), y: slump * 8, r: slump * -1.5 });
        });
        const flash = p(t, c.at("graduation"), 300) - p(t, c.at("graduation") + 500, 400);
        pose(lineEl, { o: p(t, 200, 400), s: 1 });
        lineEl.style.boxShadow = `0 0 ${(10 + flash * 40).toFixed(0)}px rgba(255, 209, 102, ${(0.3 + flash * 0.6).toFixed(2)})`;
        pose(lineTag, kf(t, c.at("graduation"), 380, POP), gone(t, grad - 150, 250));
        pose(cap, { ...kf(t, grad + 80, 420, POP), r: -10 });
        const siren = t >= grad && t < grad + 1600 ? (Math.floor((t - grad) / 170) % 2 === 0 ? 1 : 0.35) : 0;
        alarm.style.opacity = (siren * gone(t, grad + 1300, 300)).toFixed(2);
        panel.classList.toggle("alarm", t >= grad && Math.floor((t - grad) / 170) % 2 === 0 && t < grad + 1600);
        pose(stamp, kf(t, grad + 120, 330, STAMP));
      },
    };
  },
};

// ---------------- 5 · The reveal: picks, times, evidence ----------------

const PICKS = [
  // [who, option, seconds], fastest first: the order they slap down
  [PRIYA, 1, "1.2s"],
  [2, 0, "6.5s"],
  [0, 2, "8.1s"],
  [1, 1, "9.4s"],
  [4, 3, "10.2s"],
] as const;
const RROW = (i: number) => 400 + i * 135;

const reveal: SceneDef = {
  clip: "n5",
  lead: 300,
  tail: 650,
  sfx: (c) => [[c.at("picked"), "slaps", 5, 190], [c.at("and") + 120, "sting"], [c.at("flag"), "stamp"]],
  build(c) {
    const q = E("tut-chalk tut-rv-q", Q.text, 70, 245, 940);
    const opts = Q.opts.map((o, i) => E("tut-rv-opt", `<span class="l">${"ABCD"[i]}</span><span class="t">${o}</span>`, 60, RROW(i), 960, 115));
    const perRow = [0, 0, 0, 0];
    const trays = PICKS.map(([who, opt, time]) => {
      const n = perRow[opt]++;
      const cx = 925 - n * 105;
      const cy = RROW(opt) + 50;
      const a = av(who, cx, cy, 86, false);
      const tag = E(`tut-time ${who === PRIYA ? "fast" : ""}`, who === PRIYA ? `⚡${time}` : time, cx - 55, cy + 26, 110);
      return { a, tag, cx, cy };
    });
    const card = E(
      "tut-paper tut-evidence",
      `<b class="h">⚡ Lightning fast</b><span class="b">🧪 Priya answered in 1.2s. The class took about 9s.</span><span class="r">How did they know that?!</span>`,
      60,
      960,
      960,
    );
    const exhibit = E("tut-stamp red small", "Exhibit A", 700, 925);
    const priya = trays[0];
    const circle = ring(priya.cx, priya.cy, 170, 136);
    return {
      root: scene(q, ...opts, ...trays.flatMap((x) => [x.a, x.tag]), card, exhibit, circle.el),
      update(t) {
        pose(q, kf(t, 0, 400, RISE));
        opts.forEach((o, i) => pose(o, kf(t, 60 + i * 60, 380, RISE)));
        const slap = c.at("picked");
        trays.forEach((x, i) => pose(x.a, kf(t, slap + i * 190, 300, SLAP)));
        // The answer lights: B is right, the rest are crossed out.
        const lit = c.at("and") + 120;
        opts.forEach((o, i) => {
          o.classList.toggle("right", t >= lit && i === Q.right);
          o.classList.toggle("wrong", t >= lit && i !== Q.right);
        });
        trays.forEach((x, i) => pose(x.tag, kf(t, c.at("how") + i * 80, 300, POP)));
        const zap = p(t, c.at("fast."), 220) - p(t, c.at("fast.") + 220, 380);
        if (t >= c.at("how")) pose(priya.tag, { s: 1 + zap * 0.35 });
        pose(card, { ...kf(t, c.at("Evidence") - 80, 480, [[0, { y: 260, o: 0, r: 3 }], [1, { y: 0, o: 1, r: -1.5 }]]) });
        pose(exhibit, kf(t, c.at("flag"), 330, STAMP));
        circle.draw(p(t, c.at("suspicious."), 650, inOut));
      },
    };
  },
};

// ---------------- 6 · Point, accuse, vote ----------------

const AY = 400; // the row of avatars, a little lower here

const accuse: SceneDef = {
  clip: "n6",
  lead: 300,
  tail: 600,
  sfx: (c) => [
    [c.at("Suspicious?") + 100, "pop"],
    [c.at("Point"), "click"],
    [c.at("Point") + 130, "click"],
    [c.at("Point") + 260, "click"],
    [c.at("accuse!") + 220, "gavel"],
    [c.at("accusation,") + 120, "stamp"],
    [c.at("votes"), "click"],
    [c.at("votes") + 230, "click"],
    [c.at("votes") + 460, "click"],
    [c.at("votes") + 690, "click"],
  ],
  build(c) {
    const avs = CLASS.map((_, i) => av(i, ROW_X(i), AY, 120));
    const huh = E("tut-chalk yellow tut-huh", "?", ROW_X(PRIYA) - 40, 205, 80);
    const pts = [
      E("tut-emoji tut-ptr", "👉", ROW_X(1) + 45, AY - 40, 80, 80),
      E("tut-emoji tut-ptr", "👉", ROW_X(2) + 45, AY - 40, 80, 80),
      E("tut-emoji tut-ptr", "👈", ROW_X(4) - 125, AY - 40, 80, 80),
    ];
    const ptrBadge = E("tut-pill yellow", "👉 3", ROW_X(PRIYA) - 70, AY + 118, 140);
    const btn = E("tut-btn red", "🙋 Accuse", 240, 1080, 600, 150);
    const hand = E("tut-emoji", "🙋", ROW_X(4) - 50, AY - 190, 100, 100);
    const finger = E("tut-emoji tut-finger", "👆", 500, 1120, 120, 120);
    const raised = centred("red", "🙋 Ana raises<br>a hand", 640);
    const ticket = E("tut-pill big", "🙋 1 accusation each", 285, 900, 510);
    const used = E("tut-stamp orange small", "Used", 690, 870);
    const vote = E("tut-panel tut-vote", `<div class="tut-vote-h">🗳️ Class vote: who's the cheater?</div>`, 100, 760, 880, 480);
    const cands = [0, 1, 2, PRIYA].map((who, k) => {
      const x = 130 + (k % 2) * 420;
      const y = 860 + Math.floor(k / 2) * 165;
      const card = E("tut-cand", `<span class="n">${CLASS[who][1]}</span><b class="tally"></b>`, x, y, 400, 140);
      card.prepend(av(who, 70, 70, 96, false));
      return card;
    });
    const tallies = cands.map((x) => x.querySelector<HTMLElement>(".tally")!);
    const verdict = E("tut-chalk orange tut-to-det", "→ detention", 560, 1170, 420);
    return {
      root: scene(...avs, huh, ...pts, ptrBadge, hand, btn, finger, raised, ticket, used, vote, ...cands, verdict),
      update(t) {
        avs.forEach((a, i) => pose(a, kf(t, i * 70, 380, POP)));
        pose(huh, { ...kf(t, c.at("Suspicious?") + 100, 380, POP), r: swing(t, c.at("Suspicious?") + 300, 10, 120, 900) });
        pts.forEach((x, i) => pose(x, kf(t, c.at("Point") + i * 130, 320, POP)));
        pose(ptrBadge, kf(t, c.at("them."), 320, POP));
        // Sure? The big red button; Ana raises her hand and taps it.
        const fadeBtn = gone(t, c.at("then") - 100, 300);
        pose(btn, kf(t, c.at("Sure?"), 450, [[0, { y: 260, o: 0 }], [1, { y: 0, o: 1 }]]), fadeBtn);
        pose(hand, { ...kf(t, c.at("Raise"), 380, POP), r: swing(t, c.at("Raise") + 380, 14, 110, 1400) });
        const tap = c.at("accuse!");
        const reach = kf(t, tap - 520, 520, [[0, { x: 380, y: 300, o: 0 }], [1, { x: 0, y: 0, o: 1 }]], inOut);
        pose(finger, { ...reach, s: t > tap && t < tap + 170 ? 0.86 : 1 }, gone(t, tap + 420, 250));
        if (t > c.at("Sure?") + 450) pose(btn, { s: t > tap && t < tap + 170 ? 0.95 : 1 }, fadeBtn);
        pose(raised, kf(t, tap + 220, 330, STAMP), fadeBtn);
        // One accusation each: hers is spent.
        pose(ticket, kf(t, c.at("one"), 350, POP), fadeBtn);
        pose(used, kf(t, c.at("accusation,") + 120, 330, STAMP), fadeBtn);
        // Then the whole class votes.
        pose(vote, kf(t, c.at("then") + 100, 450, RISE));
        cands.forEach((x, k) => pose(x, kf(t, c.at("then") + 220 + k * 90, 380, RISE)));
        const v = c.at("votes");
        const marks = [t >= v + 690 ? 1 : 0, 0, 0, (t >= v ? 1 : 0) + (t >= v + 230 ? 1 : 0) + (t >= v + 460 ? 1 : 0)];
        tallies.forEach((el, k) => (el.textContent = "|".repeat(marks[k])));
        cands[3].classList.toggle("hot", t >= c.at("detention."));
        pose(verdict, kf(t, c.at("detention."), 380, RISE));
      },
    };
  },
};

// ---------------- 7 · What a vote does ----------------

const outcomes: SceneDef = {
  clip: "n7",
  lead: 300,
  tail: 800,
  sfx: (c) => [
    [c.at("Catch"), "stamp"],
    [c.at("wins!"), "fanfare"],
    [c.at("send") + 60, "stamp"],
    [c.at("drops."), "slide"],
    [c.at("Two") + 60, "stamp"],
    [c.at("detentions,") + 60, "stamp"],
    [c.at("graduates!"), "siren"],
  ],
  build(c) {
    // A: catch the cheater.
    const detP = E("tut-stamp orange", "Detention: Priya", 150, 330);
    const caught = E("tut-panel tut-caught", `<b>🕵️ Caught!</b><span>That was the cheater.</span>`, 120, 560, 840, 220);
    const wins = E("tut-title t2 tut-wins", "🎉 Class wins!", 0, 830, 1080);
    const party = confetti(46, 540, 900);
    // B: send an innocent.
    const detK = E("tut-stamp orange dashed", "Detention: Kiko", 160, 330);
    const innocent = E("tut-chalk orange tut-innocent", "Innocent! ✗", 0, 470, 1080);
    const linePanel = E(
      "tut-panel tut-line",
      `<div class="tut-line-h">🎓 Graduation line</div><div class="tut-line-n"><s>2100</s><em> −200 → 1900</em></div><div class="tut-line-track"></div>`,
      90,
      620,
      900,
      420,
    );
    const marker = E("tut-line-mark", "<span>🎓</span>", 0, 830, 10, 160);
    const SC = [700, 1300, 1000, 1600, 400];
    const minis = [0, 1, 2, PRIYA, 4].map((who, k) => av(who, 160 + (760 * SC[k]) / 2400, k % 2 ? 840 : 905, 64, false));
    const ex = linePanel.querySelector<HTMLElement>("em")!;
    const strike2100 = linePanel.querySelector<HTMLElement>("s")!;
    // C: two wrong detentions.
    const strikes = E("tut-strikes", `<span>Strikes</span><i class="x1"></i><i class="x2"></i>`, 190, 380, 700, 140);
    const x1 = strikes.querySelector<HTMLElement>(".x1")!;
    const x2 = strikes.querySelector<HTMLElement>(".x2")!;
    const grad = centred("red", "🚨 The cheater<br>graduates!", 600);
    const priya = av(PRIYA, 540, 960, 190);
    const cap = E("tut-emoji", "🎓", 540 - 60, 960 - 175, 120, 120);
    const alarm = E("tut-alarm", "", 0, 0, 1080, 1920);
    const xFor = (pts: number) => 90 + 70 + (760 * pts) / 2400;
    return {
      root: scene(party.el, detP, caught, wins, detK, innocent, linePanel, ...minis, marker, strikes, priya, cap, grad, alarm),
      update(t) {
        const a = gone(t, c.at("But") - 120, 260);
        pose(detP, kf(t, c.at("Catch"), 330, STAMP), a);
        pose(caught, kf(t, c.at("cheater,"), 420, RISE), a);
        pose(wins, kf(t, c.at("wins!"), 420, POP), a);
        party.burst(t, c.at("wins!"));
        party.el.style.opacity = a.toFixed(3); // the celebration leaves with its beat
        const b = gone(t, c.at("Two") - 120, 260);
        pose(detK, kf(t, c.at("send") + 60, 330, STAMP), b);
        pose(innocent, kf(t, c.at("innocent"), 360, POP), b);
        pose(linePanel, kf(t, c.at("innocent") + 200, 420, RISE), b);
        minis.forEach((m, k) => pose(m, kf(t, c.at("innocent") + 300 + k * 60, 300, POP), b));
        const drop = p(t, c.at("drops."), 650, inOut);
        marker.style.left = `${lerp(xFor(2100), xFor(1900), drop).toFixed(1)}px`;
        pose(marker, kf(t, c.at("innocent") + 300, 300, RISE), b);
        strike2100.classList.toggle("on", t >= c.at("drops."));
        pose(ex, { o: p(t, c.at("drops."), 300) });
        pose(strikes, kf(t, c.at("Two") - 60, 380, RISE));
        pose(x1, kf(t, c.at("Two") + 60, 300, STAMP));
        pose(x2, kf(t, c.at("detentions,") + 60, 300, STAMP));
        const g = c.at("graduates!");
        pose(priya, kf(t, c.at("cheater", 1) - 100, 420, POP));
        pose(cap, { ...kf(t, g + 60, 380, POP), r: -12 });
        pose(grad, kf(t, g + 100, 330, STAMP));
        alarm.style.opacity = (t >= g && t < g + 1500 ? (Math.floor((t - g) / 170) % 2 === 0 ? 0.9 : 0.3) * gone(t, g + 1200, 300) : 0).toFixed(2);
      },
    };
  },
};

// ---------------- 8 · Question ten; a tip for the cheater ----------------

const ten: SceneDef = {
  clip: "n8",
  lead: 300,
  tail: 600,
  sfx: (c) => [[c.at("ten?"), "bell"], [c.at("Top"), "sting"], [c.at("don't") + 120, "click"]],
  build(c) {
    const q10 = E("tut-title t1 tut-q10", "Q10/10", 0, 240, 1080);
    const bell = E("tut-emoji tut-bell", "🔔", 875, 250, 140, 140);
    const podium = [
      { who: 2, x: 140, h: 210, place: "2" },
      { who: 1, x: 400, h: 300, place: "1" },
      { who: 0, x: 660, h: 150, place: "3" },
    ].map(({ who, x, h, place }) => {
      const block = E("tut-podium", `<span>${place}</span>`, x, 1200 - h, 280, h);
      const a = av(who, x + 140, 1200 - h - 112, 120);
      return { block, a };
    });
    const trophy = E("tut-emoji", "🏆", 400 + 140 - 55, 1200 - 300 - 112 - 60 - 118, 110, 110);
    const top = E("tut-stamp yellow", "Top of the class", 190, 450);
    // The cheater's tip.
    const priya = av(PRIYA, 540, 400, 180);
    const wink = E("tut-bubble", "😉", 650, 250, 140, 120);
    const mini = E("tut-panel tut-mini", "", 230, 620, 620, 470);
    const rows = Q.opts.map((o, i) => {
      const r = E("tut-rv-opt small", `<span class="l">${"ABCD"[i]}</span><span class="t">${o}</span>`, 260, 650 + i * 105, 560, 88);
      if (i === Q.right) r.insertAdjacentHTML("beforeend", `<i class="tut-dot big"></i>`);
      return r;
    });
    const finger = E("tut-emoji tut-finger", "👆", 530, 650 + 2 * 105 + 20, 110, 110);
    const onPurpose = E("tut-chalk yellow tut-tip", "Miss a few on purpose!", 0, 1145, 1080);
    return {
      root: scene(q10, bell, ...podium.flatMap((x) => [x.block, x.a]), trophy, top, priya, wink, mini, ...rows, finger, onPurpose),
      update(t) {
        const A = gone(t, c.at("And") - 100, 280);
        pose(q10, kf(t, c.at("question") - 100, 420, POP), A);
        pose(bell, { ...kf(t, c.at("question"), 380, POP), r: swing(t, c.at("ten?"), 22, 90, 800) }, A);
        podium.forEach(({ block, a }, i) => {
          const k = p(t, c.at("Top") + i * 110, 420, out);
          block.style.transformOrigin = "50% 100%";
          block.style.transform = `scaleY(${k.toFixed(3)})`;
          block.style.opacity = (k > 0 ? A : 0).toFixed(3);
          pose(a, kf(t, c.at("Top") + 260 + i * 110, 320, POP), A);
        });
        pose(trophy, { ...kf(t, c.at("class") + 150, 380, POP), r: swing(t, c.at("class") + 500, 8, 140, 900) }, A);
        pose(top, kf(t, c.at("class"), 330, STAMP), A);
        // And cheater: don't look too smart. Priya taps a wrong answer on purpose.
        const B = c.at("And");
        pose(priya, kf(t, B, 380, POP));
        pose(mini, kf(t, B + 120, 420, RISE));
        rows.forEach((r, i) => pose(r, kf(t, B + 200 + i * 70, 320, RISE)));
        const tap = c.at("don't") + 120;
        const reach = kf(t, tap - 500, 500, [[0, { x: 260, y: 280, o: 0 }], [1, { x: 0, y: 0, o: 1 }]], inOut);
        pose(finger, { ...reach, s: t > tap && t < tap + 170 ? 0.86 : 1 }, gone(t, tap + 450, 250));
        rows[2].classList.toggle("wrong", t >= tap);
        pose(wink, kf(t, tap + 150, 380, POP));
        pose(onPurpose, kf(t, c.at("smart.") - 80, 420, RISE));
      },
    };
  },
};

// ---------------- 9 · Class is in session ----------------

const outro: SceneDef = {
  clip: "n9",
  lead: 300,
  tail: 2200,
  sfx: (c) => [[c.at("Class"), "bell"]],
  build(c) {
    const ph = E(
      "tut-phone tut-home",
      `<div class="tut-scr"><div class="tut-home-t"><span>🏫 How Did You</span><b>Know That?!</b></div><div class="tut-hello"><b>HELLO</b><small>my name is</small><span>${face("🧪")} Priya</span></div><div class="tut-home-btn">Join</div><div class="tut-home-btn ghost">Create</div></div>`,
      330,
      280,
      420,
      720,
    );
    const bell = E("tut-emoji tut-bell", "🔔", 90, 380, 170, 170);
    const bell2 = E("tut-emoji tut-bell", "🔔", 820, 380, 170, 170);
    const session = E("tut-title t2 tut-session", "Class is in session!", 0, 1060, 1080);
    return {
      root: scene(ph, bell, bell2, session),
      update(t) {
        pose(ph, { ...kf(t, c.at("Now") - 100, 500, [[0, { y: 420, o: 0 }], [1, { y: 0, o: 1 }]]), r: swing(t, c.at("phone."), 5, 70, 400) });
        pose(bell, { ...kf(t, c.at("Class") - 80, 360, POP), r: swing(t, c.at("Class"), 24, 90, 900) });
        pose(bell2, { ...kf(t, c.at("Class") - 80, 360, POP), r: -swing(t, c.at("Class"), 24, 90, 900) });
        pose(session, kf(t, c.at("Class"), 420, POP));
      },
    };
  },
};

export const SCENES: SceneDef[] = [title, quiz, cheater, line, reveal, accuse, outcomes, ten, outro];
