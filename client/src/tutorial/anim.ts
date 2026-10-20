// A tiny deterministic motion kit for the tutorial (v0.20). Every frame is a
// pure function of the clock: nothing on the stage animates by itself (no CSS
// transitions or keyframes), so the live playback and the MP4 export, which
// renders frame by frame, show exactly the same pictures.

export type Ease = (x: number) => number;

export const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
export const lerp = (a: number, b: number, k: number): number => a + (b - a) * k;

export const linear: Ease = (x) => x;
export const out: Ease = (x) => 1 - Math.pow(1 - x, 3);
export const inOut: Ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
/** Overshoot then settle: the game's --e-impact feel. */
export const back: Ease = (x) => 1 + 2.70158 * Math.pow(x - 1, 3) + 1.70158 * Math.pow(x - 1, 2);

/** Progress (0..1, eased) of a move that starts at t0 and lasts dur. */
export const p = (t: number, t0: number, dur: number, e: Ease = out): number => e(clamp01((t - t0) / dur));
/** 1 → 0 over [t1, t1 + dur]: a fade-out multiplier. */
export const gone = (t: number, t1: number, dur = 300): number => 1 - p(t, t1, dur, linear);

export interface Pose {
  x?: number; // px
  y?: number; // px
  s?: number; // scale
  r?: number; // degrees
  o?: number; // opacity
}

const DEF: Required<Pose> = { x: 0, y: 0, s: 1, r: 0, o: 1 };

/** Keyframes over [t0, t0 + dur]: k in 0..1, each segment eased by `e`.
 *  Before t0 it holds the first frame, after the end the last one. */
export function kf(t: number, t0: number, dur: number, frames: [number, Pose][], e: Ease = out): Required<Pose> {
  const k = clamp01((t - t0) / dur);
  let i = 0;
  while (i < frames.length - 2 && k > frames[i + 1][0]) i++;
  const [ka, a] = frames[i];
  const [kb, b] = frames[Math.min(i + 1, frames.length - 1)];
  const local = kb > ka ? e(clamp01((k - ka) / (kb - ka))) : 1;
  const A = { ...DEF, ...a };
  const B = { ...DEF, ...b };
  return { x: lerp(A.x, B.x, local), y: lerp(A.y, B.y, local), s: lerp(A.s, B.s, local), r: lerp(A.r, B.r, local), o: lerp(A.o, B.o, local) };
}

/** The game's entrances, as keyframes (tokens.css: hd-stamp, hd-slap, hd-pop). */
export const STAMP: [number, Pose][] = [[0, { o: 0, s: 2.2, r: -12 }], [0.6, { o: 1, s: 0.94, r: -4 }], [1, { o: 1, s: 1, r: -4 }]];
export const SLAP: [number, Pose][] = [[0, { o: 0, s: 1.7, r: -8 }], [0.7, { o: 1, s: 0.9, r: 2 }], [1, { o: 1, s: 1, r: 0 }]];
export const POP: [number, Pose][] = [[0, { o: 0, y: 14, s: 0.6 }], [0.6, { o: 1, y: -8, s: 1.08 }], [1, { o: 1, y: 0, s: 1 }]];
export const RISE: [number, Pose][] = [[0, { o: 0, y: 40 }], [1, { o: 1, y: 0 }]];

/** Write a pose; `extra` multiplies opacity (fades shared by a group). */
export function pose(el: HTMLElement, q: Pose, extra = 1): void {
  const x = q.x ?? 0;
  const y = q.y ?? 0;
  const s = q.s ?? 1;
  const r = q.r ?? 0;
  const o = (q.o ?? 1) * extra;
  el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) rotate(${r.toFixed(2)}deg) scale(${s.toFixed(4)})`;
  el.style.opacity = o <= 0.001 ? "0" : o >= 0.999 ? "1" : o.toFixed(3);
  el.style.visibility = o <= 0.001 ? "hidden" : "";
}
