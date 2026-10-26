// One clock for the whole room. Every phone estimates its offset to the relay
// server's clock (Cristian's algorithm) and all beats are scheduled in server
// time, so they land together on every screen.
// - Error of one sample ≤ RTT/2 (path asymmetry), so the LOWEST-RTT samples
//   win — across bursts, not just within one: a resync during a congested
//   moment can't replace a good estimate with a worse one.
// - Monotonic base (performance.now; Date.now can jump) and a monotonic
//   result: serverNow() never runs backwards, so a reached beat can't un-reach.
import type { Socket } from "socket.io-client";

const localNow = () => performance.timeOrigin + performance.now();

interface Sample {
  offset: number;
  rtt: number;
  at: number; // local time taken
}

let offsetMs = 0; // serverTime - localTime
let bestRtt = Infinity;
let lastReturned = -Infinity;
/** v0.26: no sample adopted yet. Until then nothing timed is on screen (a
 *  phone syncs before it joins or hosts), so the never-backwards floor only
 *  starts with the first real estimate: a phone whose clock runs ahead must
 *  not stay pinned to its unsynced time (it skipped a bell rung within ~2s of
 *  joining, as long as its clock was ahead). */
let synced = false;
let override: (() => number) | null = null;
const pool: Sample[] = []; // best samples across bursts
const POOL_MAX = 12;
const SAMPLE_TTL_MS = 10 * 60_000; // clocks drift; old samples expire

/** Current time on the shared (server) clock, in epoch ms. Never decreases. */
export function serverNow(): number {
  if (override) return override();
  const t = localNow() + offsetMs;
  if (!synced) return t;
  if (t < lastReturned) return lastReturned;
  lastReturned = t;
  return t;
}

/** Fixture/replay mode drives time from a tape instead of the network. */
export function setClockOverride(fn: (() => number) | null): void {
  override = fn;
}

export function clockStatus(): { offsetMs: number; rttMs: number } {
  return { offsetMs, rttMs: bestRtt };
}

function sample(socket: Socket): Promise<Sample | null> {
  return new Promise((resolve) => {
    const t0 = localNow();
    let done = false;
    const timer = setTimeout(() => {
      done = true;
      resolve(null);
    }, 2000);
    socket.emit("time", (server: number) => {
      if (done) return;
      clearTimeout(timer);
      const t1 = localNow();
      const rtt = t1 - t0;
      resolve({ offset: server - (t0 + rtt / 2), rtt, at: t1 });
    });
  });
}

/** Take n samples, merge them into the pool of best samples, and adopt the
 *  median offset of the lowest-RTT third of the pool. */
export async function syncClock(socket: Socket, n = 8): Promise<void> {
  for (let i = 0; i < n; i++) {
    const s = await sample(socket);
    if (s) pool.push(s);
    await new Promise((r) => setTimeout(r, 60));
  }
  const now = localNow();
  const fresh = pool.filter((s) => now - s.at < SAMPLE_TTL_MS).sort((a, b) => a.rtt - b.rtt);
  pool.splice(0, pool.length, ...fresh.slice(0, POOL_MAX));
  if (!pool.length) return;
  const best = pool.slice(0, Math.max(1, Math.ceil(pool.length / 3)));
  const offsets = best.map((s) => s.offset).sort((a, b) => a - b);
  const mid = offsets.length >> 1;
  offsetMs = offsets.length % 2 ? offsets[mid] : (offsets[mid - 1] + offsets[mid]) / 2;
  bestRtt = best[0].rtt;
  synced = true;
}

/** Keep the estimate fresh: periodic resync, and immediately when the page
 *  comes back from the background (mobile browsers suspend timers). */
export function maintainClock(socket: Socket): void {
  const resync = () => void syncClock(socket, 5);
  setInterval(resync, 30_000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") resync();
  });
  window.addEventListener("pageshow", resync);
  socket.on("connect", resync);
}
