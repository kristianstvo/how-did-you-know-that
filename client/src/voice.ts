// The TV host's voice (v0.19): Amy, recorded with ElevenLabs (the script:
// hostLines.ts), speaking from the big screen only. Phones never download a
// clip. What she says when: host.ts.
// - One voice at a time. A headline ("cut") stops whatever she was saying
//   (unless that sentence ends within its grace), an aside speaks only into
//   silence, a follow-up ("next") waits its turn.
// - A line can be placed on the shared clock so one word lands on a beat:
//   "The answer is... B!" as B lights up (sayTimed).
// - Each clip is measured as it loads: its loudness (every line speaks at the
//   same level), where its words start and end, and where its last word
//   starts (the letter of an answer call). Nothing about timing is stored.
// - While she speaks, the game's sound effects duck.
// Browsers only play audio after a click or a key. Until then her lines go by
// unheard, except the welcome, which waits for that first click.
import { serverNow } from "./clock";
import { HOST_LINES, type LineId } from "./hostLines";
import { duckSfx, liveAudio } from "./sound";

export interface Clip {
  buf: AudioBuffer;
  dur: number; // ms
  gain: number; // loudness match
  lead: number; // ms of silence before the first word
  end: number; // ms: the last word ends (after it, only room tone)
  hit: number; // ms: the last word starts
}

interface Line {
  id: LineId;
  clip: Clip;
  at: number; // shared-clock ms when the clip starts
  stopAt: number; // shared-clock ms it was told to stop (Infinity: plays out)
  aside: boolean; // said into silence, so a timed headline may cut it short
  src: AudioBufferSourceNode | null; // null: unheard (audio still locked)
  amp: GainNode | null;
  log: VoiceLog | null;
}

type Mode = "cut" | "aside" | "next";

const LEVEL = 0.9; // her voice over the effects (their master is 0.32)
const LOUD = 0.11; // target speaking level: RMS of the voiced 10ms windows
const GAP = 150; // ms between a line and its follow-up
const KEY = "hdykt-voice";

const clips = new Map<LineId, Clip>();
let lines: Line[] = []; // playing or scheduled
let started = false;
let pending: { id: LineId; ok: () => boolean } | null = null;
let muted = false;
try {
  muted = localStorage.getItem(KEY) === "off";
} catch {
  /* storage blocked: on */
}

// Test hook: every line she started (or scheduled), next to the beat telemetry.
// `hit`/`end` = when its last word starts/ends; `cut` = when a newer line or a hush stopped it.
type VoiceLog = { id: LineId; at: number; hit: number; end: number; heard: boolean; cut?: number };
type Telemetry = { voice?: VoiceLog[]; voiceReady?: boolean };
const telemetry = () => (window as unknown as { __hdykt?: Telemetry }).__hdykt;

/** Loudness and word timing from 10ms energy windows. A pause of 120ms+
 *  starts a new word group; the last group's start is the clip's hit. */
function measure(buf: AudioBuffer): Clip {
  const d = buf.getChannelData(0);
  const W = Math.max(1, Math.round(buf.sampleRate / 100));
  const env: number[] = [];
  let peak = 0;
  for (let i = 0; i + W <= d.length; i += W) {
    let e = 0;
    for (let j = i; j < i + W; j++) {
      e += d[j] * d[j];
      peak = Math.max(peak, Math.abs(d[j]));
    }
    env.push(Math.sqrt(e / W));
  }
  const th = Math.max(0.008, env.reduce((a, b) => Math.max(a, b), 0) * 0.06);
  let first = -1;
  let last = -1;
  let hit = 0;
  let e2 = 0;
  let n = 0;
  env.forEach((v, k) => {
    if (v <= th) return;
    if (first < 0) first = k;
    if (last < 0 || k - last > 12) hit = k;
    last = k;
    e2 += v * v;
    n++;
  });
  const rms = Math.sqrt(e2 / Math.max(1, n));
  return {
    buf,
    dur: buf.duration * 1000,
    gain: Math.min(LOUD / Math.max(rms, 1e-3), 0.95 / Math.max(peak, 1e-3), 4),
    lead: Math.max(0, first) * 10,
    end: (last + 1) * 10,
    hit: hit * 10,
  };
}

/** The big screen only: load and measure every clip. */
export function startHostVoice(): void {
  if (started) return;
  started = true;
  void (async () => {
    if (typeof OfflineAudioContext === "undefined") return;
    // Decoding needs no unlocked audio: an offline context decodes, and any
    // context can play the result.
    const dec = new OfflineAudioContext(1, 1, 44100);
    await Promise.all(
      (Object.keys(HOST_LINES) as LineId[]).map(async (id) => {
        try {
          const res = await fetch(`voice/${id}.mp3`);
          if (res.ok) clips.set(id, measure(await dec.decodeAudioData(await res.arrayBuffer())));
        } catch {
          /* a clip that won't load: she skips that line */
        }
      }),
    );
    const t = telemetry();
    if (t) t.voiceReady = true;
    flush();
  })();
  // sound.ts resumes audio on the same first click or key: then the line
  // that was waiting for it (the welcome) plays.
  const unlock = () => [120, 500, 1200].forEach((ms) => setTimeout(flush, ms));
  document.addEventListener("pointerdown", unlock, { passive: true });
  document.addEventListener("keydown", unlock);
}

function flush(): void {
  if (!pending || !clips.has(pending.id) || !liveAudio()) return;
  const p = pending;
  pending = null;
  if (p.ok()) say(p.id, { mode: "aside" });
}

const soundsUntil = (l: Line) => Math.min(l.at + l.clip.dur, l.stopAt);
const speaksUntil = (l: Line) => Math.min(l.at + l.clip.end, l.stopAt);

/** When her last word ends (shared-clock ms; 0 = silent). A line stays
 *  tracked until it has really gone quiet, even if it was told to stop at
 *  some later moment. `skipAsides`: a timed headline may cut an aside short. */
function busyUntil(skipAsides = false): number {
  const now = serverNow();
  lines = lines.filter((l) => soundsUntil(l) > now);
  return lines.reduce((t, l) => (skipAsides && l.aside ? t : Math.max(t, speaksUntil(l))), 0);
}

/** Stop one line at `t`: a quick fade, or it never starts at all if it was
 *  scheduled after `t`. Its words still to come count as cut. */
function stop(l: Line, t: number): void {
  if (t >= soundsUntil(l)) return;
  if (l.log && speaksUntil(l) > t) l.log.cut = Math.round(t);
  l.stopAt = t;
  const ctx = liveAudio();
  if (!l.src || !l.amp || !ctx) return;
  const when = ctx.currentTime + Math.max(0, (t - serverNow()) / 1000);
  try {
    l.amp.gain.setTargetAtTime(0, when, 0.025);
    l.src.stop(when + 0.12);
  } catch {
    /* already stopped */
  }
}

/** Duck the effects for exactly what she still has to say. */
function reduck(): void {
  const ctx = liveAudio();
  if (!ctx) return;
  const left = Math.max(0, busyUntil() - serverNow()) / 1000;
  duckSfx(ctx.currentTime, ctx.currentTime + left);
}

/** A new screen: follow-ups queued on the last one that haven't started yet
 *  are dropped (what she's saying now, she finishes). */
export function dropQueued(): void {
  const now = serverNow();
  const queued = lines.filter((l) => l.at > now);
  for (const l of queued) stop(l, now);
  if (queued.length) reduck();
}

function commit(id: LineId, clip: Clip, at: number, aside = false): void {
  for (const l of lines) stop(l, at); // one voice at a time
  const line: Line = { id, clip, at, stopAt: Infinity, aside, src: null, amp: null, log: null };
  const ctx = liveAudio();
  if (ctx) {
    const delay = (at - serverNow()) / 1000;
    const when = ctx.currentTime + Math.max(0, delay);
    const skip = Math.max(0, -delay); // a late start skips leading silence
    const src = ctx.createBufferSource();
    src.buffer = clip.buf;
    const amp = ctx.createGain();
    amp.gain.value = clip.gain * LEVEL;
    src.connect(amp).connect(ctx.destination);
    src.start(when, skip);
    duckSfx(when, when + Math.max(0, clip.end / 1000 - skip));
    line.src = src;
    line.amp = amp;
  }
  lines.push(line);
  const t = telemetry();
  if (t) {
    line.log = { id, at: Math.round(at), hit: Math.round(at + clip.hit), end: Math.round(at + clip.end), heard: !!line.src };
    (t.voice ??= []).push(line.log);
  }
}

/** Say a line now (or at `at`, shared-clock ms). If she is mid-sentence and
 *  will finish within `wait` ms, it follows that sentence; otherwise "cut"
 *  (the default) stops her, "next" lets her finish and drops this line, and
 *  "aside" only ever speaks into silence. False if not said. */
export function say(id: LineId, { mode = "cut", at, wait = 0 }: { mode?: Mode; at?: number; wait?: number } = {}): boolean {
  const clip = clips.get(id);
  if (!started || muted || !clip) return false;
  const now = serverNow();
  let start = Math.max(at ?? now, now - clip.lead);
  const busy = busyUntil();
  if (busy > start) {
    if (mode === "aside") return false;
    const follows = busy + GAP - start <= wait;
    if (mode === "next" && !follows) return false;
    if (follows) start = busy + GAP;
  }
  commit(id, clip, start, mode === "aside");
  return true;
}

/** Place a line by its own timing: `startOf(clip)` is when it must start
 *  (e.g. so its last word lands on a beat). The first of `ids` that can
 *  start on time without talking over a headline is said (an aside, like
 *  "Five seconds!" just before everyone answered, gets cut short). */
export function sayTimed(ids: LineId[], startOf: (c: Clip) => number): LineId | null {
  if (!started || muted) return null;
  const now = serverNow();
  const busy = busyUntil(true);
  for (const id of ids) {
    const clip = clips.get(id);
    if (!clip) continue;
    const start = startOf(clip);
    if (start < now - clip.lead || start < busy) continue; // too late, or over another line
    commit(id, clip, start);
    return id;
  }
  return null;
}

/** Say `id` as soon as she can be heard (clips loaded, audio unlocked by a
 *  click or a key), if `ok()` still holds by then. */
export function sayWhenHeard(id: LineId, ok: () => boolean): void {
  pending = { id, ok };
  flush();
}

/** Stop talking: what she was talking about has gone. */
export function hush(): void {
  pending = null;
  const now = serverNow();
  for (const l of lines) stop(l, now);
  reduck();
}

/** The big screen's V key: her voice off or back on. Returns true if on. */
export function toggleHostVoice(): boolean {
  muted = !muted;
  try {
    localStorage.setItem(KEY, muted ? "off" : "on");
  } catch {
    /* storage blocked: this session only */
  }
  if (muted) hush();
  return !muted;
}
