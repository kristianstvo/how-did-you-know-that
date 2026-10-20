// PHONE PLAY: the things that go wrong on real phones, played out end to end
// on a phone-sized touch screen (375×553 = an iPhone SE with Safari's bars).
//   · the host's phone drops out mid-match (screen lock, app switch, signal)
//     and comes back — nobody is kicked, the game carries on
//   · the host's page reloads mid-match and takes the class back (v0.14)
//   · a player's phone drops out and comes back to the same seat
//   · a reload mid-match takes the seat back without retyping anything
//   · a fumbled double-tap on ACCUSE does nothing
//   · a vote tap only PICKS; the ballot goes in with Hand in, or by itself
//     just before the bell
//   · every new screen starts at its top
//   · no input is small enough for iOS to zoom; nothing scrolls sideways
//   · the screen is kept awake in a classroom; the host's page asks before
//     leaving mid-game
//   · your report card counts a finished period once, across a reload (v0.12)
//   · a big screen (#/tv/CODE) shows the show without joining the class (v0.16)
import { expect, test, type Browser, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";

const SE = { width: 375, height: 553 };

async function phone(browser: Browser, url = "/", viewport = SE) {
  const ctx = await browser.newContext({ viewport, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  // Headless Edge has no real screen to keep on: stand in a Wake Lock that
  // records what the game asks for.
  await ctx.addInitScript(() => {
    const log = { requests: 0, held: false };
    (window as unknown as { __wake: typeof log }).__wake = log;
    Object.defineProperty(navigator, "wakeLock", {
      configurable: true,
      value: {
        request: async () => {
          log.requests++;
          log.held = true;
          const listeners: (() => void)[] = [];
          return {
            release: async () => {
              log.held = false;
              listeners.forEach((f) => f());
            },
            addEventListener: (_: string, f: () => void) => listeners.push(f),
          };
        },
      },
    });
  });
  const page = await ctx.newPage();
  await page.goto(url);
  return { ctx, page };
}

/** Host "Hana" + human players + bots, started. Returns the pages. */
async function classroom(browser: Browser, humans: string[], bots: number) {
  const host = await phone(browser);
  await host.page.fill("#playerName", "Hana");
  await host.page.click('[data-action="create"]');
  const code = (await host.page.locator(".roomcode").innerText({ timeout: 15000 })).replace(/\s/g, "");
  const players: { name: string; page: Page; ctx: Awaited<ReturnType<typeof phone>>["ctx"] }[] = [];
  for (const name of humans) {
    const p = await phone(browser, `/#/join/${code}`);
    await p.page.fill("#playerName", name);
    await p.page.click('[data-action="join"]');
    await p.page.waitForSelector(".screen-lobby");
    players.push({ name, ...p });
  }
  for (let i = 0; i < bots; i++) {
    await host.page.click("#lb-addbot");
    await host.page.waitForTimeout(120);
  }
  await host.page.click("#lb-start");
  const close = async () => {
    for (const p of [host, ...players]) await p.ctx.close();
  };
  return { host, players, code, close };
}

const banner = (page: Page) => page.evaluate(() => ({ on: document.getElementById("net")?.classList.contains("on") ?? false, status: document.getElementById("net")?.dataset.status ?? "" }));
const answer = (page: Page) => page.locator("button.opt:not([disabled])").first().click({ timeout: 30000 });

test("phone: the host's phone drops out mid-match and comes back; nobody is kicked", async ({ browser }) => {
  const { host, players, close } = await classroom(browser, ["Bea"], 2);
  const bea = players[0].page;
  await bea.waitForSelector("button.opt:not([disabled])", { timeout: 30000 });

  await host.page.evaluate(() => (window.__hdykt as unknown as { dropSocket(): void }).dropSocket());
  // The class is told, not thrown out…
  await expect.poll(async () => (await banner(bea)).status, { timeout: 10000 }).toBe("hostAway");
  expect(await bea.locator(".screen-home").count()).toBe(0);
  // …and the host's phone takes the room back by itself.
  await expect.poll(async () => (await banner(bea)).on, { timeout: 20000 }).toBe(false);
  await expect.poll(async () => (await banner(host.page)).on, { timeout: 20000 }).toBe(false);

  // The game carries on: both answer, the reveal reaches both phones.
  await answer(host.page).catch(() => {});
  await answer(bea).catch(() => {});
  await bea.waitForSelector(".screen-reveal", { timeout: 30000 });
  await host.page.waitForSelector(".screen-reveal", { timeout: 30000 });
  await close();
});

test("phone: the host's page reloads mid-match and takes the class back", async ({ browser }) => {
  const { host, players, close } = await classroom(browser, ["Bea"], 2);
  const bea = players[0].page;
  await bea.waitForSelector("button.opt:not([disabled])", { timeout: 30000 });
  host.page.on("dialog", (d) => void d.accept()); // "Leave site?": yes, reload
  await host.page.reload();
  // Straight back into the same period: no home screen, no new room.
  await expect(host.page.locator(".screen-question, .screen-reveal").first()).toBeVisible({ timeout: 20000 });
  expect(await host.page.locator(".screen-home").count()).toBe(0);
  // The class only saw "the teacher's phone dropped out" for a moment.
  await expect.poll(async () => (await banner(bea)).on, { timeout: 20000 }).toBe(false);
  expect(await bea.locator(".screen-home").count()).toBe(0);
  // The game carries on: both answer, the reveal reaches both phones…
  await answer(host.page).catch(() => {});
  await answer(bea).catch(() => {});
  await bea.waitForSelector(".screen-reveal", { timeout: 30000 });
  await host.page.waitForSelector(".screen-reveal", { timeout: 30000 });
  // …with the same class: Bea in her seat and connected, nobody added.
  await expect(host.page.locator('.gb-row[title="Bea"]')).toBeAttached({ timeout: 15000 });
  await expect(host.page.locator(".gb-row")).toHaveCount(4);
  await close();
});

test("phone: a player's phone drops out and comes back to the same seat", async ({ browser }) => {
  const { host, players, close } = await classroom(browser, ["Bea"], 2);
  const bea = players[0].page;
  await bea.waitForSelector("button.opt:not([disabled])", { timeout: 30000 });
  await bea.evaluate(() => (window.__hdykt as unknown as { dropSocket(): void }).dropSocket());
  // She is told (the reconnect backoff is ≥500ms, so this is always seen)…
  await expect.poll(async () => (await banner(bea)).status, { timeout: 5000, intervals: [50] }).toBe("reconnecting");
  // …and is back without doing anything.
  await expect.poll(async () => (await banner(bea)).on, { timeout: 20000 }).toBe(false);
  // Same seat: still in the match, can still answer, and the host never lost her.
  await answer(bea);
  await expect(bea.locator(".screen-question.is-locked, .screen-reveal").first()).toBeVisible({ timeout: 15000 });
  await expect(host.page.locator('[id^="qz-desk-"][title^="Bea"], .gb-row[title^="Bea"]').first()).toBeAttached({ timeout: 15000 });
  await close();
});

test("phone: a reload mid-match takes the seat back without retyping", async ({ browser }) => {
  const { players, close } = await classroom(browser, ["Bea"], 2);
  const bea = players[0].page;
  await bea.waitForSelector(".screen-question, .screen-role", { timeout: 30000 });
  await bea.reload();
  // Straight back into the match: no home screen to fill in again.
  await expect(bea.locator(".screen-question, .screen-reveal, .screen-role").first()).toBeVisible({ timeout: 20000 });
  expect(await bea.locator(".screen-home").count()).toBe(0);
  await close();
});

test("phone: a fumbled double-tap on ACCUSE does nothing; a vote tap only picks; Hand in sends; a pick goes in before the bell", async ({ browser }) => {
  const { host, players, close } = await classroom(browser, ["Bea"], 2);
  const bea = players[0].page;
  await answer(host.page);
  await answer(bea);
  await host.page.waitForSelector("#rv-host", { timeout: 40000 });
  await host.page.click("#rv-host"); // skip the show to the accuse beat
  await host.page.waitForSelector("#rv-accuse.st-go:not([disabled])", { timeout: 15000 });

  // Two taps 90ms apart = a fumble, not a decision.
  const box = (await host.page.locator("#rv-accuse").boundingBox())!;
  const [x, y] = [box.x + box.width / 2, box.y + box.height / 2];
  await host.page.touchscreen.tap(x, y);
  await host.page.waitForTimeout(90);
  await host.page.touchscreen.tap(x, y);
  await host.page.waitForTimeout(1200);
  expect(await host.page.locator(".screen-vote").count(), "a double-tap must not burn the token").toBe(0);
  await expect(host.page.locator("#rv-accuse.st-confirm")).toBeVisible();
  // A deliberate confirm (≥450ms later) does open the vote.
  await host.page.touchscreen.tap(x, y);
  await host.page.waitForSelector(".screen-vote", { timeout: 10000 });
  await bea.waitForSelector(".screen-vote", { timeout: 10000 });

  // Host: tap a classmate = a pick, not a ballot.
  const hostId = (await host.page.locator(".vo-cell:has(.vo-you)").getAttribute("id"))!.slice(3);
  const target = host.page.locator(".vo-cell:not(:has(.vo-you))").first();
  await target.click();
  await expect(host.page.locator("#vo-go:not([disabled])")).toBeVisible();
  await host.page.waitForTimeout(400);
  expect(await host.page.locator(`#vs-${hostId}.in`).count(), "a pick must not hand the ballot in").toBe(0);
  await host.page.click("#vo-go");
  await expect(host.page.locator(`#vs-${hostId}.in`)).toBeAttached({ timeout: 5000 });

  // Bea only picks, never presses Hand in: it goes in before the bell.
  const beaId = (await bea.locator(".vo-cell:has(.vo-you)").getAttribute("id"))!.slice(3);
  await bea.locator(".vo-cell:not(:has(.vo-you))").first().click();
  await host.page.waitForSelector(".screen-voteResult", { timeout: 30000 });
  await expect(host.page.locator(`#vl-${beaId}`), "Bea's picked ballot was counted").toBeAttached();
  await expect(host.page.locator(`#vl-${hostId}`)).toBeAttached();
  await close();
});

test("phone: pointing at a suspect is free, public and changeable", async ({ browser }) => {
  const { host, players, close } = await classroom(browser, ["Bea"], 2);
  const bea = players[0].page;
  await answer(host.page);
  await answer(bea);
  await host.page.waitForSelector("#rv-host", { timeout: 40000 });
  await host.page.click("#rv-host"); // skip to the accuse beat
  await bea.waitForSelector("#rv-point:not([disabled])", { timeout: 15000 });
  // Bea points at Hana from the sheet (52px rows, thumb reach)…
  await bea.click("#rv-point");
  const row = bea.locator(".pt-row", { hasText: "Hana" });
  expect((await row.boundingBox())!.height).toBeGreaterThanOrEqual(48);
  await row.click();
  await expect(bea.locator("#pt-sheet")).toHaveCount(0);
  // …everyone sees it on the grade book, and her button shows whom she points at.
  await expect(host.page.locator(".gb-row", { hasText: "Hana" }).locator(".ptr")).toHaveText("👉1", { timeout: 5000 });
  await expect(bea.locator("#rv-point.on")).toBeVisible();
  // It costs nothing: her accusation is untouched.
  await expect(bea.locator("#rv-accuse.st-go")).toBeVisible();
  // And it is changeable: stop pointing clears it for everyone.
  await bea.waitForTimeout(400); // past the 350ms broadcast coalescing
  await bea.click("#rv-point");
  await bea.click("#pt-stop");
  await expect(host.page.locator(".gb-row", { hasText: "Hana" }).locator(".ptr")).toHaveCount(0, { timeout: 5000 });
  await close();
});

test("phone: your report card counts a finished period once, across a reload", async ({ browser }) => {
  // Bea is the cheater (local test hook); the class catches her after Q1.
  const host = await phone(browser, "/?debugCheater=Bea");
  await host.page.fill("#playerName", "Hana");
  await host.page.click('[data-action="create"]');
  const code = (await host.page.locator(".roomcode").innerText({ timeout: 15000 })).replace(/\s/g, "");
  const join = async (name: string) => {
    const p = await phone(browser, `/#/join/${code}`);
    await p.page.fill("#playerName", name);
    await p.page.click('[data-action="join"]');
    await p.page.waitForSelector(".screen-lobby");
    return p;
  };
  const bea = await join("Bea");
  const cy = await join("Cy");
  // Nobody has a report card yet.
  expect(await bea.page.locator("#hm-record").count()).toBe(0);
  await host.page.click("#lb-start");
  for (const p of [host.page, bea.page, cy.page]) await answer(p);
  await host.page.waitForSelector("#rv-host", { timeout: 40000 });
  await host.page.click("#rv-host"); // skip to the accuse beat
  await cy.page.waitForSelector("#rv-accuse.st-go:not([disabled])", { timeout: 15000 });
  await cy.page.click("#rv-accuse");
  await cy.page.waitForTimeout(600); // a deliberate confirm, not a fumble
  await cy.page.click("#rv-accuse");
  const vote = async (p: Page, whom: string) => {
    await p.waitForSelector(".screen-vote", { timeout: 15000 });
    await p.locator(`.vo-cell:has(.vo-nm[title="${whom}"])`).click();
    await p.click("#vo-go");
  };
  await vote(host.page, "Bea");
  await vote(cy.page, "Bea");
  await vote(bea.page, "Cy");
  await host.page.click("#vr-continue", { timeout: 30000 });
  await bea.page.waitForSelector(".screen-matchEnd", { timeout: 30000 });
  // v0.17: after the unmask, how the cheater played against the class.
  await expect(cy.page.locator("#me-tells")).toContainText("/1 right", { timeout: 15000 });
  // Bea reloads on the report card: she's back, and it still counts once.
  await bea.page.reload();
  await bea.page.waitForSelector(".screen-matchEnd", { timeout: 20000 });
  // …and closes the tab and comes back through the invite link in a new one
  // (v0.18: still once).
  await bea.page.close();
  const again = await bea.ctx.newPage();
  await again.goto(`/#/join/${code}`);
  await again.click('[data-action="join"]');
  await again.waitForSelector(".screen-matchEnd", { timeout: 20000 });
  const record = async (ctx: Awaited<ReturnType<typeof phone>>["ctx"]) => {
    const tab = await ctx.newPage(); // a new tab on the same phone, days later
    await tab.goto("/");
    const card = tab.locator("#hm-record");
    await expect(card).toBeVisible({ timeout: 10000 });
    await card.locator("summary").click();
    const out = { sum: await card.locator(".hm-rec-sum").innerText(), cells: await card.locator(".hm-rec-cell").allInnerTexts() };
    await tab.close();
    return out;
  };
  const b = await record(bea.ctx);
  expect(b.sum).toContain("1 period");
  expect(b.cells.join("|").replace(/\s+/g, " ")).toContain("1 time the cheater");
  const c = await record(cy.ctx);
  expect(c.sum).toContain("1 period");
  expect(c.cells.join("|").replace(/\s+/g, " ")).toContain("1 cheater caught");
  for (const p of [host, bea, cy]) await p.ctx.close();
});

test("big screen: a TV shows the show without joining the class", async ({ browser }) => {
  const host = await phone(browser);
  await host.page.fill("#playerName", "Hana");
  await host.page.click('[data-action="create"]');
  const code = (await host.page.locator(".roomcode").innerText({ timeout: 15000 })).replace(/\s/g, "");
  const tvCtx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const tv = await tvCtx.newPage();
  await tv.goto(`/#/tv/${code}`);
  // The way in, large: the QR and the code. Nothing to tap.
  await expect(tv.locator("#lb-tvjoin")).toBeVisible({ timeout: 15000 });
  await expect(tv.locator("#lb-tvjoin")).toContainText(code);
  await expect(tv.locator("#lb-invite")).toBeHidden();
  // Never in the class: the teacher sees a 📺, and still one desk taken.
  await expect(host.page.locator(".lb-screens")).toBeVisible({ timeout: 10000 });
  await expect(host.page.locator(".lb-row")).toHaveCount(1);
  for (let i = 0; i < 2; i++) {
    await host.page.click("#lb-addbot");
    await host.page.waitForTimeout(120);
  }
  await host.page.click("#lb-start");
  // The show reaches the big screen: the question, with nothing to answer…
  await expect(tv.locator(".screen-question")).toBeVisible({ timeout: 30000 });
  expect(await tv.locator("button.opt:not([disabled])").count()).toBe(0);
  // …then the reveal, with no dock to accuse from; the class is still three.
  await answer(host.page).catch(() => {});
  await expect(tv.locator(".screen-reveal")).toBeVisible({ timeout: 40000 });
  await expect(tv.locator("#rv-accuse")).toBeHidden();
  await expect(host.page.locator(".gb-row")).toHaveCount(3);
  await tvCtx.close();
  await host.ctx.close();
});

test("phone: someone arriving mid-period watches from the hallway, without answering", async ({ browser }) => {
  const { host, code, close } = await classroom(browser, [], 3);
  await host.page.waitForSelector("button.opt:not([disabled])", { timeout: 30000 });
  const late = await phone(browser, `/#/join/${code}`);
  await late.page.fill("#playerName", "Eve");
  await late.page.click('[data-action="join"]');
  // In, watching the period: not turned away, not on the home screen.
  await expect(late.page.locator(".screen-question, .screen-reveal").first()).toBeVisible({ timeout: 15000 });
  await expect.poll(async () => (await banner(late.page)).status, { timeout: 5000 }).toBe("hallway");
  // Watching, not playing: the answers are closed to them.
  if (await late.page.locator(".screen-question").count()) {
    expect(await late.page.locator("button.opt:not([disabled])").count()).toBe(0);
  }
  // The teacher's phone counts them in the hallway, not in the class.
  await expect.poll(() => host.page.evaluate(() => document.querySelectorAll(".gb-row, [id^=qz-desk-]").length)).toBeGreaterThan(0);
  await late.ctx.close();
  await close();
});

test("phone: the teacher sets the pace with one tap, and everyone sees it", async ({ browser }) => {
  const host = await phone(browser);
  await host.page.fill("#playerName", "Hana");
  await host.page.click('[data-action="create"]');
  const code = (await host.page.locator(".roomcode").innerText({ timeout: 15000 })).replace(/\s/g, "");
  const guest = await phone(browser, `/#/join/${code}`);
  await guest.page.fill("#playerName", "Bea");
  await guest.page.click('[data-action="join"]');
  await guest.page.waitForSelector(".screen-lobby");
  expect((await host.page.locator("#pace-quick").boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await host.page.click("#pace-quick");
  await expect(host.page.locator("#pace-quick")).toHaveAttribute("aria-pressed", "true");
  await expect(guest.page.locator(".lb-rules-ro")).toContainText("10s");
  // The balance numbers stay one tap away, folded.
  await expect(host.page.locator("#lb-adv")).not.toHaveAttribute("open", "");
  await host.ctx.close();
  await guest.ctx.close();
});

test("phone: Practice with bots puts a solo player in a ready classroom", async ({ browser }) => {
  const { ctx, page } = await phone(browser);
  await page.fill("#playerName", "Solo");
  await page.click("#hm-practice");
  await page.waitForSelector(".screen-lobby");
  await expect(page.locator(".lb-row.is-bot")).toHaveCount(5);
  await expect(page.locator("#lb-start:not([disabled])")).toBeVisible();
  await ctx.close();
});

test("phone: the screen stays awake in a classroom; the host's page asks before leaving mid-game", async ({ browser }) => {
  const home = await phone(browser);
  expect(await home.page.evaluate(() => (window as unknown as { __wake: { requests: number } }).__wake.requests)).toBe(0);
  await home.ctx.close();

  const { host, players, close } = await classroom(browser, ["Bea"], 2);
  for (const p of [host.page, players[0].page]) {
    await expect.poll(() => p.evaluate(() => (window as unknown as { __wake: { held: boolean } }).__wake.held)).toBe(true);
  }
  const asks = (p: Page) =>
    p.evaluate(() => {
      const e = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(e);
      return e.defaultPrevented;
    });
  expect(await asks(host.page), "the host's page is the game").toBe(true);
  expect(await asks(players[0].page), "a player can reload and rejoin").toBe(false);
  await close();
});

test("phone: the lobby shows a scan-to-join QR big enough to read across a table", async ({ browser }) => {
  const { ctx, page } = await phone(browser, "/#/fixture/caught?as=innocent&t=-1500&paused=1&ui=0");
  await page.waitForFunction(() => !!window.__fixture);
  await page.click("#lb-qr-btn");
  const code = page.locator(".lb-qr-code svg");
  await expect(code).toBeVisible();
  // The dialog takes focus (keyboards, screen readers)…
  await expect.poll(() => page.evaluate(() => document.activeElement?.id)).toBe("lb-qr-close");
  expect((await code.boundingBox())!.width, "QR width on an SE").toBeGreaterThanOrEqual(240);
  // Tapping the card itself (someone pointing at it) keeps it up; Done closes it.
  await page.click(".lb-qr-card h2");
  await expect(code).toBeVisible();
  const done = (await page.locator("#lb-qr-close").boundingBox())!;
  expect(done.y + done.height, "Done sits on screen").toBeLessThanOrEqual(553);
  await page.click("#lb-qr-close");
  await expect(page.locator("#lb-qr")).toHaveCount(0);
  // …and gives it back to the button that opened it.
  await expect.poll(() => page.evaluate(() => document.activeElement?.id)).toBe("lb-qr-btn");
  await ctx.close();
});

// ---- Layout checks on recorded matches (no network) ----

interface Tape {
  t0: number;
  frames: { state: { phase: string; phaseStartedAt: number; match: { questionIdx: number } | null } }[];
}
function phaseAt(name: string, phase: string, qi?: number): number {
  const t = JSON.parse(readFileSync(`client/public/fixtures/${name}.json`, "utf8")) as Tape;
  const f = t.frames.find((x) => x.state.phase === phase && (qi === undefined || x.state.match?.questionIdx === qi))!;
  return Math.round(f.state.phaseStartedAt - t.t0);
}

test("phone: game-show sound plays on the beats, the same for the cheater, and one switch silences it", async ({ browser }) => {
  const from = phaseAt("caught", "question", 3) + 9000; // the end of Q4, then its reveal
  const hear = async (view: string) => {
    const { ctx, page } = await phone(browser, `/#/fixture/caught?as=cheater${view}&t=${from}&ui=0`);
    await page.waitForFunction(() => !!window.__fixture);
    await page.click(".qz-head"); // a first tap unlocks audio on phones
    await page.waitForTimeout(9000);
    const sounds = await page.evaluate(() => (window.__hdykt as unknown as { sounds?: string[] }).sounds ?? []);
    await ctx.close();
    return sounds;
  };
  const real = await hear("");
  const masked = await hear("&mask=1");
  // The show in order: pencils down, slaps, drumroll, the answer sting.
  const order = ["whistle", "slaps", "drumroll", "sting"].map((x) => real.indexOf(x));
  expect(order.every((i) => i >= 0), `heard: ${real.join(",")}`).toBe(true);
  expect(order, "in beat order").toEqual([...order].sort((a, b) => a - b));
  expect(masked, "the cheater's phone sounds exactly like an innocent's").toEqual(real);

  // One switch, remembered on this phone.
  const { ctx, page } = await phone(browser, "/#/fixture/caught?as=innocent&t=-1500&paused=1&ui=0");
  await page.waitForFunction(() => !!window.__fixture);
  await page.click("#snd-lb-snd");
  await expect(page.locator("#snd-lb-snd")).toHaveAttribute("aria-pressed", "false");
  await page.goto(`/#/fixture/caught?as=innocent&t=${from}&ui=0`);
  await page.reload();
  await page.waitForFunction(() => !!window.__fixture);
  await page.click(".qz-head");
  await page.waitForTimeout(9000);
  expect(await page.evaluate(() => (window.__hdykt as unknown as { sounds?: string[] }).sounds ?? [])).toEqual([]);
  await ctx.close();
});

test("phone: the first period teaches in Act I (Teacher's notes), then gets out of the way", async ({ browser }) => {
  const at = (q: number) => phaseAt("caught", "reveal", q) + 9000;
  const { ctx, page } = await phone(browser, `/#/fixture/caught?as=innocent&t=${at(0)}&paused=1&ui=0`);
  await page.waitForFunction(() => !!window.__fixture);
  await expect(page.locator(".ev-teach")).toContainText("Teacher's note");
  const box = (await page.locator(".ev-teach").boundingBox())!;
  expect(box.width).toBeGreaterThan(200);
  await page.evaluate((t) => window.__fixture!.seek(t), at(4));
  await page.waitForTimeout(600);
  expect(await page.locator(".ev-teach").count(), "no notes after Act I").toBe(0);
  await ctx.close();
});

test("phone: every new screen starts at its top", async ({ browser }) => {
  const { ctx, page } = await phone(browser, `/#/fixture/fullclass?as=innocent&t=${phaseAt("fullclass", "vote") - 2500}&paused=1&ui=0`);
  await page.waitForFunction(() => !!window.__fixture);
  await page.waitForTimeout(800);
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  expect(await page.evaluate(() => scrollY)).toBeGreaterThan(100);
  await page.evaluate((t) => window.__fixture!.seek(t), phaseAt("fullclass", "vote") + 2500);
  await page.waitForTimeout(900);
  expect(await page.evaluate(() => scrollY)).toBe(0);
  const stamp = (await page.locator("#vo-stamp").boundingBox())!;
  expect(stamp.y + stamp.height).toBeLessThan(SE.height);
  await ctx.close();
});

test("phone: no field small enough for iOS to zoom; nothing scrolls sideways at 320px", async ({ browser }) => {
  const urls = [
    "/",
    "/#/join/ABCDE",
    "/#/fixture/fullclass?as=innocent&t=-1500&paused=1&ui=0&host=1",
    `/#/fixture/fullclass?as=innocent&t=${phaseAt("fullclass", "question", 7) + 3000}&paused=1&ui=0`,
    `/#/fixture/fullclass?as=innocent&t=${phaseAt("fullclass", "reveal", 4) + 9500}&paused=1&ui=0`,
    `/#/fixture/fullclass?as=innocent&t=${phaseAt("fullclass", "vote") + 3000}&paused=1&ui=0`,
    `/#/fixture/fullclass?as=innocent&t=${phaseAt("fullclass", "matchEnd") + 7000}&paused=1&ui=0&host=1`,
  ];
  for (const url of urls) {
    const { ctx, page } = await phone(browser, url, { width: 320, height: 568 });
    if (url.includes("fixture")) await page.waitForFunction(() => !!window.__fixture);
    await page.waitForTimeout(900);
    const r = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      small: [...document.querySelectorAll("input, select, textarea")].filter((el) => parseFloat(getComputedStyle(el).fontSize) < 16).map((el) => el.id),
    }));
    expect(r.overflow, `${url} scrolls sideways`).toBe(false);
    expect(r.small, `${url}: iOS would zoom into these`).toEqual([]);
    await ctx.close();
  }
});
