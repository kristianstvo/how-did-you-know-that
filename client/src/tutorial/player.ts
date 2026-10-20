// The how-to-play tutorial (v0.20): a narrated, captioned 9:16 animation of
// the rules, in Amy's voice (narration.ts) over the storyboard (scenes.ts).
// - Phones: Home → "▶ How to play" opens it full screen.
// - The big screen plays it once in homeroom after the host's welcome, with
//   the way in (QR, code) and the class beside it; H plays it again.
// - #/tutorial/render is the frame-exact page tools/tutorial-video.mjs films
//   into an MP4: window.__tut.seek(ms) poses one frame, renderAudio() mixes
//   the soundtrack offline (her voice plus the game's own sound effects).
// The scenes are pure functions of the clock, and while there is sound the
// clock IS the audio clock, so the words and the pictures never drift apart.
import "../styles/tutorial.css";
import { renderSVG } from "uqr";
import { sfx, sfxOffline, soundOn, wakeAudio } from "../sound";
import { CLIPS, type Clip } from "./narration";
import { SCENES, type Cues, type Scene, type SceneDef, type SfxCue } from "./scenes";

const FADE = 350; // the dissolve between scenes
const FX_GAIN = 0.85; // the effects a little under her voice

interface Placed {
  def: SceneDef;
  clip: Clip;
  start: number; // ms on the tutorial clock
  end: number;
  voiceAt: number; // when her line starts
  cues: Cues;
  scene?: Scene;
}

const norm = (w: string) => w.toLowerCase().replace(/^[^a-z0-9']+|[^a-z0-9']+$/g, "");

function cuesFor(clip: Clip, lead: number): Cues {
  const word = (w: string, nth = 0) => {
    const hit = clip.words.filter(([x]) => norm(x) === norm(w))[nth];
    if (!hit) throw new Error(`tutorial: "${w}" #${nth} is not in ${clip.id}`);
    return hit;
  };
  return { at: (w, nth) => lead + word(w, nth)[1], end: (w, nth) => lead + word(w, nth)[2] };
}

/** Scene after scene, each as long as its line plus its lead and its tail. */
export function plan(): { placed: Placed[]; total: number } {
  let t = 0;
  const placed = SCENES.map((def) => {
    const clip = CLIPS.find((c) => c.id === def.clip)!;
    const start = t;
    t += def.lead + clip.ms + def.tail;
    return { def, clip, start, end: t, voiceAt: start + def.lead, cues: cuesFor(clip, def.lead) };
  });
  return { placed, total: t };
}

/** Every sound effect on the tutorial clock, in order. */
const effectsOf = (placed: Placed[]): SfxCue[] =>
  placed.flatMap((pl) => pl.def.sfx(pl.cues).map(([at, name, ...args]): SfxCue => [pl.start + at, name, ...args])).sort((a, b) => a[0] - b[0]);

interface CapWord {
  text: string;
  at: number;
  end: number;
}
interface Page {
  words: CapWord[];
  from: number;
  until: number;
}
const CAP_MAX = 36; // characters per caption page (two lines at most)

/** Caption pages: a sentence at a time, or ~36 characters when it's longer. */
function pagesOf(placed: Placed[]): Page[] {
  const pages: Page[] = [];
  for (const pl of placed) {
    let cur: CapWord[] = [];
    let len = 0;
    const flush = () => {
      if (cur.length) pages.push({ words: cur, from: cur[0].at, until: cur[cur.length - 1].end });
      cur = [];
      len = 0;
    };
    for (const [text, s, e] of pl.clip.words) {
      const ends = /[.!?…,]$/.test(text);
      if (cur.length && len + 1 + text.length > CAP_MAX + (ends ? 8 : 0)) flush();
      cur.push({ text, at: pl.voiceAt + s, end: pl.voiceAt + e });
      len += (cur.length > 1 ? 1 : 0) + text.length;
      if (/[.!?…]$/.test(text) && len >= 12) flush();
    }
    flush();
  }
  pages.forEach((pg, i) => {
    const next = pages[i + 1];
    pg.until = next && next.from - pg.until < 1200 ? next.from : pg.until + 800;
  });
  return pages;
}

const SCRIPT = CLIPS.map((c) => c.line.replace(/\[[^\]]+\]\s*/g, "")).join(" ");

/** The stage: every scene, the chrome and the captions, posed for one moment. */
class Stage {
  readonly el: HTMLElement;
  private readonly dots: HTMLElement[];
  private readonly capBox: HTMLElement;
  private capPage = -1;
  private capSpans: HTMLElement[] = [];

  constructor(
    private readonly placed: Placed[],
    private readonly pages: Page[],
  ) {
    this.el = document.createElement("div");
    this.el.className = "tut-stage";
    this.el.setAttribute("aria-hidden", "true");
    for (const pl of placed) {
      pl.scene = pl.def.build(pl.cues);
      this.el.append(pl.scene.root);
    }
    const top = document.createElement("div");
    top.className = "tut-a tut-top";
    top.textContent = "How to play";
    const dots = document.createElement("div");
    dots.className = "tut-a tut-dots";
    this.dots = placed.map(() => dots.appendChild(document.createElement("i")));
    const foot = document.createElement("div");
    foot.className = "tut-a tut-foot";
    foot.innerHTML = "🏫 How Did You <b>Know That?!</b>";
    const cap = document.createElement("div");
    cap.className = "tut-a tut-cap";
    this.capBox = cap.appendChild(document.createElement("div"));
    this.capBox.className = "tut-cap-box";
    this.capBox.style.visibility = "hidden"; // until her first word
    this.el.append(top, dots, foot, cap);
  }

  render(ms: number): void {
    const last = this.placed.length - 1;
    let current = 0;
    this.placed.forEach((pl, i) => {
      if (ms >= pl.start) current = i;
      const root = pl.scene!.root;
      const visible = ms >= pl.start && (i === last || ms < pl.end + FADE);
      root.style.display = visible ? "" : "none";
      if (!visible) return;
      const fadeIn = i === 0 ? 1 : Math.min(1, (ms - pl.start) / FADE);
      const fadeOut = i === last ? 1 : 1 - Math.min(1, Math.max(0, (ms - pl.end) / FADE));
      root.style.opacity = (fadeIn * fadeOut).toFixed(3);
      pl.scene!.update(ms - pl.start);
    });
    this.dots.forEach((d, i) => (d.className = i === current ? "on" : i < current ? "past" : ""));
    // Captions: the page being said; the word being said in yellow.
    const page = this.pages.findIndex((pg) => ms >= pg.from - 120 && ms < pg.until);
    if (page !== this.capPage) {
      this.capPage = page;
      this.capBox.replaceChildren();
      this.capSpans = (this.pages[page]?.words ?? []).map((w, i) => {
        if (i) this.capBox.append(" ");
        const s = document.createElement("span");
        s.textContent = w.text;
        this.capBox.append(s);
        return s;
      });
      this.capBox.style.visibility = page < 0 ? "hidden" : "";
    }
    const words = this.pages[page]?.words ?? [];
    words.forEach((w, i) => {
      const next = words[i + 1];
      const now = ms >= w.at && (next ? ms < next.at : ms < w.end + 400);
      this.capSpans[i].className = now ? "now" : ms >= w.at ? "said" : "";
    });
  }
}

const decoded = new WeakMap<BaseAudioContext, Promise<AudioBuffer[]>>();
function clipsFor(ctx: BaseAudioContext, placed: Placed[]): Promise<AudioBuffer[]> {
  let p = decoded.get(ctx);
  if (!p) {
    p = Promise.all(placed.map(async (pl) => ctx.decodeAudioData(await (await fetch(`tutorial/${pl.clip.id}.mp3`)).arrayBuffer())));
    decoded.set(ctx, p);
  }
  return p;
}

export interface TutorialOptions {
  /** The big screen: show the way in and the class beside the stage. */
  tv?: { code: string; url: string; who: () => { face: string; name: string }[] };
  onClose?: () => void;
}

let current: { close(): void } | null = null;
export const tutorialPlaying = (): boolean => current !== null;
export const closeTutorial = (): void => current?.close();

/** Play the tutorial full screen. Call it from a tap or a key press: that is
 *  what lets the browser start the sound. */
export function playTutorial(opts: TutorialOptions = {}): void {
  current?.close();
  const { placed, total } = plan();
  const stage = new Stage(placed, pagesOf(placed));
  const fx = effectsOf(placed);

  const root = document.createElement("div");
  root.id = "tut";
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "true");
  root.setAttribute("aria-label", "How to play: a one-minute video");
  const fit = document.createElement("div");
  fit.className = "tut-fit";
  fit.append(stage.el);
  const script = document.createElement("p");
  script.className = "sr-only";
  script.textContent = SCRIPT;
  const loading = document.createElement("div");
  loading.className = "tut-loading";
  loading.textContent = "Getting the class ready…";
  root.append(fit, script, loading);

  let side: { left: HTMLElement; right: HTMLElement; who: HTMLElement } | null = null;
  if (opts.tv) {
    const left = document.createElement("div");
    left.className = "tut-side";
    left.innerHTML = `<h3>Scan to join</h3><div class="qr">${renderSVG(opts.tv.url, { ecc: "M", border: 2, pixelSize: 8, whiteColor: "#ffffff", blackColor: "#111111" })}</div>`;
    const code = document.createElement("div");
    code.className = "code";
    code.textContent = opts.tv.code;
    left.append(code);
    const right = document.createElement("div");
    right.className = "tut-side";
    right.innerHTML = `<h3>In class</h3>`;
    const who = right.appendChild(document.createElement("div"));
    who.className = "who";
    const note = right.appendChild(document.createElement("p"));
    note.className = "note";
    note.textContent = "The teacher rings the bell when everyone's in.";
    root.append(left, right);
    side = { left, right, who };
  } else {
    const close = document.createElement("button");
    close.className = "tut-close";
    close.setAttribute("aria-label", "Close the video");
    close.textContent = "✕";
    close.addEventListener("click", () => current?.close());
    const end = document.createElement("div");
    end.className = "tut-end";
    const again = document.createElement("button");
    again.className = "btn";
    again.textContent = "▶ Watch again";
    again.addEventListener("click", () => void start());
    const done = document.createElement("button");
    done.className = "btn secondary";
    done.textContent = "Got it!";
    done.addEventListener("click", () => current?.close());
    end.append(again, done);
    root.append(close, end);
  }
  document.body.append(root);

  const layout = () => {
    const W = root.clientWidth;
    const H = root.clientHeight;
    const s = side ? (H * 0.97) / 1920 : Math.min(W / 1080, H / 1920);
    fit.style.transform = `scale(${s.toFixed(5)}) translate(-50%, -50%)`;
    if (side) {
      const gutter = (W - 1080 * s) / 2;
      const show = gutter > 200;
      for (const [el, x] of [
        [side.left, 0],
        [side.right, W - gutter],
      ] as const) {
        el.style.display = show ? "" : "none";
        el.style.left = `${x + gutter * 0.08}px`;
        el.style.width = `${gutter * 0.84}px`;
      }
    }
  };
  layout();
  addEventListener("resize", layout);

  let raf = 0;
  let stopped = false;
  let sources: AudioBufferSourceNode[] = [];
  let clock = () => 0;
  let nextFx = 0;
  let lastWho = "";

  const refreshWho = () => {
    if (!side || !opts.tv) return;
    const people = opts.tv.who();
    const key = people.map((p) => p.face + p.name).join("|");
    if (key === lastWho) return;
    lastWho = key;
    side.who.replaceChildren(
      ...people.map((p) => {
        const s = document.createElement("span");
        s.textContent = `${p.face} ${p.name}`;
        return s;
      }),
    );
  };

  const frame = () => {
    if (stopped) return;
    const ms = clock();
    stage.render(Math.min(ms, total));
    // Effects fire as the clock passes them (a stale one, after a stall, is dropped).
    while (nextFx < fx.length && fx[nextFx][0] <= ms) {
      const [at, name, ...args] = fx[nextFx++];
      if (ms - at < 300) (sfx as unknown as Record<string, (...a: number[]) => void>)[name](...args);
    }
    refreshWho();
    if (ms >= total) {
      root.classList.remove("playing");
      root.classList.add("done");
      if (side) setTimeout(() => current?.close(), 1200);
      return;
    }
    raf = requestAnimationFrame(frame);
  };

  const stopAudio = () => {
    for (const s of sources) {
      try {
        s.stop();
      } catch {
        /* not started */
      }
    }
    sources = [];
  };

  const start = async () => {
    cancelAnimationFrame(raf);
    stopAudio();
    nextFx = 0;
    root.classList.remove("done", "playing");
    stage.render(0);
    // Ask for the sound first, inside the tap that opened the tutorial.
    const ctx = soundOn() ? await wakeAudio() : null;
    if (stopped) return;
    let voiced = false;
    if (ctx) {
      try {
        const bufs = await clipsFor(ctx, placed);
        if (stopped) return;
        const t0 = ctx.currentTime + 0.15;
        sources = placed.map((pl, i) => {
          const s = ctx.createBufferSource();
          s.buffer = bufs[i];
          s.connect(ctx.destination);
          s.start(t0 + pl.voiceAt / 1000);
          return s;
        });
        clock = () => (ctx.currentTime - t0) * 1000;
        voiced = true;
      } catch {
        /* the clips won't load: captions only */
      }
    }
    if (!voiced) {
      const w0 = performance.now();
      clock = () => performance.now() - w0;
    }
    root.classList.add("playing");
    const t = (window as unknown as { __hdykt?: { tutorial?: { voiced: boolean; total: number } } }).__hdykt;
    if (t) t.tutorial = { voiced, total };
    raf = requestAnimationFrame(frame);
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") current?.close();
  };
  document.addEventListener("keydown", onKey);

  current = {
    close() {
      if (stopped) return;
      stopped = true;
      cancelAnimationFrame(raf);
      stopAudio();
      removeEventListener("resize", layout);
      document.removeEventListener("keydown", onKey);
      root.remove();
      current = null;
      opts.onClose?.();
    },
  };
  void start();
}

/** #/tutorial/render: the stage alone at 1080×1920, posed by the exporter. */
export function mountTutorialRender(): void {
  const { placed, total } = plan();
  const stage = new Stage(placed, pagesOf(placed));
  const root = document.createElement("div");
  root.id = "tut";
  root.className = "render";
  const fit = document.createElement("div");
  fit.className = "tut-fit";
  fit.append(stage.el);
  root.append(fit);
  document.body.append(root);
  document.documentElement.style.overflow = "hidden";
  const fx = effectsOf(placed);
  (window as unknown as { __tut: unknown }).__tut = {
    total,
    ready: document.fonts.ready.then(() => true),
    seek: (ms: number) => stage.render(ms),
    /** The soundtrack, mixed offline: base64 of a 48 kHz mono 16-bit WAV. */
    async renderAudio(): Promise<string> {
      const rate = 48000;
      const ctx = new OfflineAudioContext(1, Math.ceil((total / 1000 + 0.5) * rate), rate);
      const bufs = await clipsFor(ctx, placed);
      placed.forEach((pl, i) => {
        const s = ctx.createBufferSource();
        s.buffer = bufs[i];
        s.connect(ctx.destination);
        s.start(pl.voiceAt / 1000);
      });
      const fxBus = ctx.createGain();
      fxBus.gain.value = 0.32 * FX_GAIN; // the effects' live master level
      fxBus.connect(ctx.destination);
      for (const [at, name, ...args] of fx) sfxOffline(ctx, fxBus, at / 1000, name, args);
      return wavBase64(await ctx.startRendering());
    },
  };
}

function wavBase64(buf: AudioBuffer): string {
  const d = buf.getChannelData(0);
  const bytes = new Uint8Array(44 + d.length * 2);
  const v = new DataView(bytes.buffer);
  const tag = (o: number, s: string) => [...s].forEach((ch, i) => v.setUint8(o + i, ch.charCodeAt(0)));
  tag(0, "RIFF");
  v.setUint32(4, 36 + d.length * 2, true);
  tag(8, "WAVE");
  tag(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, buf.sampleRate, true);
  v.setUint32(28, buf.sampleRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  tag(36, "data");
  v.setUint32(40, d.length * 2, true);
  for (let i = 0; i < d.length; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, d[i])) * 0x7fff, true);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
