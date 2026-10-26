// Game-show sound (v0.6): every sound is synthesized with Web Audio — no
// files to download — and fired from the same shared-clock beats as the
// motion, so the room hears each stamp together. Sounds never depend on the
// secret: the cheater's phone sounds exactly like everyone else's.
// iOS/Safari: "ambient" audio respects the silent switch and mixes with a
// voice call instead of interrupting it. The context unlocks on the first tap.

type Wave = OscillatorType;
type AudioSessionNav = Navigator & { audioSession?: { type: string } };

const KEY = "hdykt-sound";
let enabled = true;
try {
  enabled = localStorage.getItem(KEY) !== "off";
} catch {
  /* storage blocked: default on */
}

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let duckNode: GainNode | null = null; // v0.19: the effects step back while the TV host speaks
let noiseBuf: AudioBuffer | null = null;

function audio(): AudioContext | null {
  if (!enabled || typeof window === "undefined") return null;
  if (!ctx) {
    try {
      const nav = navigator as AudioSessionNav;
      if (nav.audioSession) nav.audioSession.type = "ambient";
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.32;
      duckNode = ctx.createGain();
      master.connect(duckNode).connect(ctx.destination);
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    } catch {
      ctx = null;
      return null;
    }
  }
  if (ctx.state === "suspended") void ctx.resume().catch(() => {});
  return ctx;
}

/** Where a sound goes: the live speakers, or (v0.20) an offline render that
 *  starts the sound `t0` seconds into it (the tutorial's video export). */
interface Out {
  c: BaseAudioContext;
  out: AudioNode;
  noise: AudioBuffer;
  t0: number;
}
let offline: Out | null = null;
function target(): Out | null {
  if (offline) return offline;
  const c = audio();
  if (!c || !master || !noiseBuf) return null;
  return { c, out: master, noise: noiseBuf, t0: c.currentTime };
}

/** One enveloped oscillator note, `at` seconds from now. */
function tone(freq: number, at: number, dur: number, opts: { wave?: Wave; gain?: number; to?: number; attack?: number } = {}): void {
  const tg = target();
  if (!tg) return;
  const { c, out: master } = tg;
  const t = tg.t0 + at;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = opts.wave ?? "sine";
  o.frequency.setValueAtTime(freq, t);
  if (opts.to) o.frequency.exponentialRampToValueAtTime(opts.to, t + dur);
  const peak = opts.gain ?? 0.4;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + (opts.attack ?? 0.006));
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.02);
}

/** A filtered noise burst, `at` seconds from now. */
function hiss(at: number, dur: number, opts: { gain?: number; type?: BiquadFilterType; freq?: number; q?: number } = {}): void {
  const tg = target();
  if (!tg) return;
  const { c, out: master } = tg;
  const t = tg.t0 + at;
  const src = c.createBufferSource();
  src.buffer = tg.noise;
  const f = c.createBiquadFilter();
  f.type = opts.type ?? "bandpass";
  f.frequency.value = opts.freq ?? 1800;
  f.Q.value = opts.q ?? 0.8;
  const g = c.createGain();
  g.gain.setValueAtTime(opts.gain ?? 0.3, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(master);
  src.start(t, Math.random() * 0.5);
  src.stop(t + dur + 0.02);
}

const NOTE = (semis: number) => 523.25 * Math.pow(2, semis / 12); // C5 = 0

export const sfx = {
  /** The school bell: the role screen, and the last question. */
  bell(): void {
    for (let i = 0; i < 4; i++) {
      tone(1046, i * 0.11, 0.5, { gain: 0.22 });
      tone(2093, i * 0.11, 0.35, { gain: 0.08 });
    }
  },
  /** A question lands on the desk. */
  pop(): void {
    tone(660, 0, 0.09, { wave: "triangle", gain: 0.25, to: 990 });
  },
  /** The last five seconds. */
  tick(): void {
    hiss(0, 0.03, { type: "highpass", freq: 3200, gain: 0.35 });
  },
  /** Pencils down. */
  whistle(): void {
    tone(1568, 0, 0.32, { wave: "sine", gain: 0.22, to: 1480 });
  },
  /** Avatars slap onto their answers, fastest first. */
  slaps(count: number, staggerMs: number): void {
    for (let i = 0; i < count; i++) {
      tone(170, (i * staggerMs) / 1000, 0.09, { gain: 0.5, to: 80 });
      hiss((i * staggerMs) / 1000, 0.03, { type: "lowpass", freq: 900, gain: 0.25 });
    }
  },
  /** The snare roll before the answer; louder as it goes. */
  drumroll(ms: number): void {
    const n = Math.max(3, Math.floor(ms / 45));
    for (let i = 0; i < n; i++) hiss((i * 45) / 1000, 0.04, { freq: 1900, q: 0.6, gain: 0.08 + (0.32 * i) / n });
  },
  /** Ta-da: the answer. */
  sting(): void {
    [0, 4, 7, 12].forEach((s, i) => tone(NOTE(s), i * 0.065, 0.42, { wave: "triangle", gain: 0.24 }));
  },
  /** A rubber stamp: exhibits, verdicts, CLEARED, DETENTION. */
  stamp(): void {
    tone(120, 0, 0.16, { gain: 0.7, to: 55 });
    hiss(0, 0.05, { type: "lowpass", freq: 700, gain: 0.4 });
  },
  /** Order in class: someone raised a hand. */
  gavel(): void {
    for (const at of [0, 0.19]) {
      tone(210, at, 0.12, { gain: 0.6, to: 95 });
      hiss(at, 0.04, { type: "lowpass", freq: 1200, gain: 0.35 });
    }
  },
  /** The graduation line drops. */
  slide(): void {
    tone(940, 0, 0.62, { wave: "sine", gain: 0.2, to: 280 });
  },
  /** Alarm bells: the cheater graduated. */
  siren(): void {
    for (let i = 0; i < 3; i++) {
      tone(620, i * 0.6, 0.3, { wave: "sawtooth", gain: 0.07, to: 980 });
      tone(980, i * 0.6 + 0.3, 0.3, { wave: "sawtooth", gain: 0.07, to: 620 });
    }
  },
  /** Class dismissed: the cheater was caught. */
  fanfare(): void {
    [-5, 0, 4, 7].forEach((s, i) => tone(NOTE(s), i * 0.12, 0.3, { wave: "triangle", gain: 0.26 }));
    for (const s of [0, 4, 7, 12]) tone(NOTE(s), 0.5, 1.1, { wave: "triangle", gain: 0.12 });
  },
  /** UI taps: an answer locks in, a ballot is handed in. */
  click(): void {
    tone(1250, 0, 0.035, { wave: "square", gain: 0.06 });
  },
  /** v0.25: a tomato lands on the cheater (the big screen only). */
  splat(): void {
    tone(90, 0, 0.25, { gain: 0.5, to: 55 });
    hiss(0, 0.25, { type: "lowpass", freq: 650, gain: 0.3 });
  },
  /** v0.25: a round of applause lands (the big screen only). */
  clap(): void {
    for (const at of [0, 0.07, 0.15]) hiss(at, 0.02, { freq: 1500, q: 0.7, gain: 0.3 });
  },
};

// Test hook: the last sounds fired (names only), next to the beat telemetry.
type Sfx = Record<string, (...args: number[]) => void>;
const RAW: Sfx = { ...(sfx as unknown as Sfx) }; // unwrapped, for offline renders
for (const name of Object.keys(sfx)) {
  const play = (sfx as unknown as Sfx)[name];
  (sfx as unknown as Sfx)[name] = (...args: number[]) => {
    if (!enabled) return;
    const log = (window as unknown as { __hdykt?: { sounds?: string[] } }).__hdykt;
    if (log) (log.sounds ??= []).push(name);
    play(...args);
  };
}

export const soundOn = (): boolean => enabled;

/** v0.20: wake audio inside a tap (the tutorial's Play button): the running
 *  context, or null when sound is off or the browser refuses. */
export async function wakeAudio(): Promise<AudioContext | null> {
  const c = audio();
  if (!c) return null;
  if (c.state !== "running") await c.resume().catch(() => {});
  return (c.state as string) === "running" ? c : null;
}

/** v0.20: render one effect into an offline context, starting `at` seconds
 *  in, through `out` (the tutorial's video export). Same synthesis as live. */
const noiseFor = new WeakMap<BaseAudioContext, AudioBuffer>();
export function sfxOffline(c: BaseAudioContext, out: AudioNode, at: number, name: keyof typeof sfx, args: number[] = []): void {
  let noise = noiseFor.get(c);
  if (!noise) {
    noise = c.createBuffer(1, c.sampleRate, c.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    noiseFor.set(c, noise);
  }
  offline = { c, out, noise, t0: at };
  try {
    RAW[name](...args);
  } finally {
    offline = null;
  }
}

/** v0.19: the audio context, but only once a click or a key has let it run
 *  (sound off, or still locked: null). The TV host speaks through it. */
export function liveAudio(): AudioContext | null {
  const c = audio();
  return c && c.state === "running" ? c : null;
}

/** v0.19: the effects duck under the host's voice from `from` to `to`
 *  (AudioContext seconds). A newer line replaces the window of the one it cuts. */
export function duckSfx(from: number, to: number): void {
  if (!duckNode) return;
  const g = duckNode.gain;
  g.cancelScheduledValues(from);
  g.setTargetAtTime(0.45, from, 0.04);
  g.setTargetAtTime(1, Math.max(from, to), 0.2);
}

export function setSound(on: boolean): void {
  enabled = on;
  try {
    localStorage.setItem(KEY, on ? "on" : "off");
  } catch {
    /* storage blocked: this session only */
  }
  if (on) sfx.click();
  else void ctx?.suspend().catch(() => {});
}

if (typeof document !== "undefined") {
  // iOS unlocks audio only inside a gesture: create/resume on the first tap.
  document.addEventListener("pointerdown", () => void audio(), { passive: true });
  document.addEventListener("keydown", () => void audio()); // a TV remote's OK button (v0.18)
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && enabled && ctx?.state === "suspended") void ctx.resume().catch(() => {});
  });
}
