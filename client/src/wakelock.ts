// Keeps the screen on while this phone is in a classroom. Phones auto-lock
// after as little as 30s without a touch, and a reveal discussion easily runs
// longer — a locked phone drops its connection, and the host's phone runs the
// whole game. Screen Wake Lock API: Chrome Android 84+, Safari iOS 16.4+.
// The browser releases the lock whenever the page is hidden, so it is taken
// again on return (and on the next tap, for browsers that want a gesture).

type Sentinel = { release(): Promise<void>; addEventListener(type: "release", fn: () => void): void };
type WakeLockNav = Navigator & { wakeLock?: { request(type: "screen"): Promise<Sentinel> } };

let wanted = false;
let sentinel: Sentinel | null = null;
let requesting = false;

async function acquire(): Promise<void> {
  const nav = navigator as WakeLockNav;
  if (!wanted || sentinel || requesting || !nav.wakeLock || document.visibilityState !== "visible") return;
  requesting = true;
  try {
    const s = await nav.wakeLock.request("screen");
    s.addEventListener("release", () => {
      if (sentinel === s) sentinel = null;
    });
    sentinel = s;
    if (!wanted) void release(); // the session ended while we waited
  } catch {
    /* refused (battery saver, no gesture yet, unsupported): try again later */
  } finally {
    requesting = false;
  }
}

async function release(): Promise<void> {
  const s = sentinel;
  sentinel = null;
  try {
    await s?.release();
  } catch {
    /* already released */
  }
}

/** true while in a lobby or match; false back on the home screen. */
export function keepAwake(on: boolean): void {
  wanted = on;
  if (on) void acquire();
  else void release();
}

/** Test hook: is the screen being held on right now? */
export const awake = (): boolean => !!sentinel;

if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => void acquire());
  document.addEventListener("pointerdown", () => void acquire(), { passive: true });
}
