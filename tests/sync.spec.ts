// SYNC: three phones' beats must land within 150ms of each other.
// Live room on the real relay: host + two players + bots. Two players get
// their monotonic clocks deliberately skewed (+2.5s, −1.7s) so the shared-clock
// offset estimation is actually exercised — same-machine contexts would
// otherwise share one clock and pass trivially. Each phone records the true
// machine time (Date.now, unskewed) at which it rendered each beat.
import { expect, test, type Browser, type Page } from "@playwright/test";

async function phone(browser: Browser, skewMs: number, url = "/", latencyMs = 0) {
  const ctx = await browser.newContext();
  await ctx.addInitScript((skew: number) => {
    const real = performance.now.bind(performance);
    performance.now = () => real() + skew;
  }, skewMs);
  if (latencyMs) {
    // One-way latency on this phone's WebSocket, both directions. (Chromium's
    // DevTools network emulation doesn't apply to WebSocket frames, so the
    // socket itself is wrapped: every send and every received message waits.)
    await ctx.addInitScript((delay: number) => {
      const Native = window.WebSocket;
      class SlowSocket extends Native {
        send(data: string | ArrayBufferLike | Blob | ArrayBufferView) {
          setTimeout(() => {
            if (this.readyState === Native.OPEN) super.send(data);
          }, delay);
        }
        set onmessage(fn: ((ev: MessageEvent) => void) | null) {
          super.onmessage = fn ? (ev: MessageEvent) => setTimeout(() => fn.call(this, ev), delay) : null;
        }
        get onmessage() {
          return super.onmessage;
        }
      }
      window.WebSocket = SlowSocket as typeof WebSocket;
    }, latencyMs);
  }
  const page = await ctx.newPage();
  await page.goto(url);
  return { ctx, page };
}

async function answerWhenAsked(page: Page) {
  // Tap the first enabled option whenever a question is on screen.
  await page.evaluate(() => {
    setInterval(() => {
      const opt = document.querySelector<HTMLButtonElement>("button.opt:not([disabled])");
      if (opt) opt.click();
    }, 700);
  });
}

for (const latency of [0, 150]) test(`sync: beats land within 150ms across three phones with skewed clocks${latency ? ` and +${latency}ms network latency on one` : ""}`, async ({ browser }) => {
  const host = await phone(browser, 0, "/?debugCheater=Bea");
  await host.page.fill("#playerName", "Hana");
  await host.page.click('[data-action="create"]');
  const code = (await host.page.locator(".roomcode").innerText({ timeout: 15000 })).replace(/\s/g, "");

  const p1 = await phone(browser, 2500, `/#/join/${code}`);
  const p2 = await phone(browser, -1700, `/#/join/${code}`, latency);
  for (const [p, name] of [
    [p1, "Bea"],
    [p2, "Cy"],
  ] as const) {
    await p.page.fill("#playerName", name);
    await p.page.click('[data-action="join"]');
  }
  await host.page.waitForFunction(() => document.querySelectorAll('[id^="roster-"]').length >= 3, null, { timeout: 15000 });
  await host.page.click('[data-action="addBot"]');
  await host.page.waitForTimeout(400);
  await host.page.click('[data-action="start"]');

  for (const p of [host, p1, p2]) await answerWhenAsked(p.page);
  // Host taps Next as soon as it is enabled, until 3 reveals have been seen.
  await host.page.evaluate(() => {
    setInterval(() => {
      const next = document.querySelector<HTMLButtonElement>('[data-action="advance"]:not([disabled])');
      if (next) next.click();
    }, 500);
  });
  await host.page.waitForFunction(() => (window.__hdykt?.beats ?? []).filter((b) => b.key.startsWith("reveal-") && b.key.endsWith("accuse")).length >= 3, null, { timeout: 150_000 });
  await host.page.waitForTimeout(500);

  const read = (p: Page) => p.evaluate(() => ({ beats: window.__hdykt!.beats, clock: window.__hdykt!.clock?.() }));
  const [h, a, b] = await Promise.all([read(host.page), read(p1.page), read(p2.page)]);
  console.log("clock estimates (offset should ≈ −skew):", { host: h.clock, bea: a.clock, cy: b.clock });

  // First render of each beat key on each phone, in true machine time.
  const firstWall = (beats: { key: string; wall: number }[]) => {
    const m = new Map<string, number>();
    for (const x of beats) if (!m.has(x.key)) m.set(x.key, x.wall);
    return m;
  };
  const [mh, ma, mb] = [firstWall(h.beats), firstWall(a.beats), firstWall(b.beats)];
  const spreads: { key: string; spread: number }[] = [];
  for (const [key, t] of mh) {
    // Only timed beats (reveal/vote-result/match-end/role) seen by all three
    // phones. A key with no beat reached yet ("screen|") marks when the state
    // packet arrived — during the beat lead, before beat 0 shows anything — so
    // it measures network delay, not beat sync.
    if (!ma.has(key) || !mb.has(key) || !/^(reveal|role|voteResult|matchEnd)-/.test(key) || key.endsWith("|")) continue;
    const ts = [t, ma.get(key)!, mb.get(key)!];
    spreads.push({ key, spread: Math.max(...ts) - Math.min(...ts) });
  }
  spreads.sort((x, y) => x.spread - y.spread);
  const worst = spreads[spreads.length - 1];
  const p95 = spreads[Math.floor(spreads.length * 0.95)]?.spread ?? NaN;
  console.log(`beats compared: ${spreads.length}; median ${spreads[spreads.length >> 1]?.spread}ms; p95 ${p95}ms; worst ${worst?.spread}ms (${worst?.key})`);

  for (const p of [host, p1, p2]) await p.ctx.close();
  expect(spreads.length).toBeGreaterThan(10);
  expect(Math.abs((a.clock?.offsetMs ?? 0) + 2500)).toBeLessThan(150); // skew detected and corrected
  expect(Math.abs((b.clock?.offsetMs ?? 0) - 1700)).toBeLessThan(150);
  expect(worst.spread).toBeLessThanOrEqual(150);
});
