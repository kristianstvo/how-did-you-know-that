// PHONE PLAY: the things that go wrong on real phones, played out end to end
// on a phone-sized touch screen (375×553 = an iPhone SE with Safari's bars).
//   · the host's phone drops out mid-match (screen lock, app switch, signal)
//     and comes back — nobody is kicked, the game carries on
//   · the host's page reloads mid-match and takes the class back (v0.14)
//   · a player's phone drops out and comes back to the same seat
//   · a reload mid-match takes the seat back without retyping anything
//   · a fumbled double-tap on ACCUSE does nothing
//   · an accusation names someone, who has the floor before ballots open (v0.23)
//   · a vote tap only PICKS; the ballot goes in with Hand in, or by itself
//     just before the bell
//   · every new screen starts at its top
//   · no input is small enough for iOS to zoom; nothing scrolls sideways
//   · the screen is kept awake in a classroom; the host's page asks before
//     leaving mid-game
//   · your report card counts a finished period once, across a reload (v0.12)
//   · a big screen (#/tv/CODE) shows the show without joining the class (v0.16)
//   · Home is you first (name, student), then where to; back returns (v0.21)
//   · an avatar that isn't one of the students never reaches a screen (v0.21)
//   · nobody misses the bell: it closes How to play, and a note missed in
//     another app waits behind ⭐, read by holding 📝 (v0.27)
import { expect, test, type Browser, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { io } from "socket.io-client";

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
  await host.page.click("#hm-next");
  await host.page.click('[data-action="create"]');
  const code = (await host.page.locator(".roomcode").innerText({ timeout: 15000 })).replace(/\s/g, "");
  const players: { name: string; page: Page; ctx: Awaited<ReturnType<typeof phone>>["ctx"] }[] = [];
  for (const name of humans) {
    const p = await phone(browser, `/#/join/${code}`);
    await p.page.fill("#playerName", name);
    await p.page.click("#hm-next");
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
  const { host, players, close } = await classroom(browser, ["Bea", "Cy"], 2);
  const [bea, cy] = players.map((p) => p.page);
  for (const p of [host.page, bea, cy]) await answer(p);
  await host.page.waitForSelector("#rv-host", { timeout: 40000 });
  await host.page.click("#rv-host"); // skip the show to the accuse beat
  await host.page.waitForSelector("#rv-accuse.st-go:not([disabled])", { timeout: 15000 });
  // v0.23: an accusation names someone. The teacher points 👉 at a bot first,
  // so ACCUSE arms on them.
  await host.page.click("#rv-point");
  await host.page.locator(".pt-row", { hasText: "Sleepy Sam" }).click();
  await expect(host.page.locator("#pt-sheet")).toHaveCount(0);

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

  // The accuser's ballot went in with the accusation.
  const hostId = (await host.page.locator(".vo-cell:has(.vo-you)").getAttribute("id"))!.slice(3);
  await expect(host.page.locator(`#vs-${hostId}.in`)).toBeAttached();
  // A bot has a short floor: Bea's ballot opens within 3s, not before.
  expect(await bea.locator(".vo-cell:not([disabled])").count(), "no picking while the accused has the floor").toBe(0);
  await expect(bea.locator(".vo-cell:not([disabled])").first()).toBeVisible({ timeout: 3000 });

  // Bea: tap a classmate = a pick, not a ballot.
  const beaId = (await bea.locator(".vo-cell:has(.vo-you)").getAttribute("id"))!.slice(3);
  await bea.locator(".vo-cell:not(:has(.vo-you))").first().click();
  await expect(bea.locator("#vo-go:not([disabled])")).toBeVisible();
  await bea.waitForTimeout(400);
  expect(await host.page.locator(`#vs-${beaId}.in`).count(), "a pick must not hand the ballot in").toBe(0);
  await bea.click("#vo-go");
  await expect(host.page.locator(`#vs-${beaId}.in`)).toBeAttached({ timeout: 5000 });

  // Cy only picks, never presses Hand in: it goes in before the bell.
  const cyId = (await cy.locator(".vo-cell:has(.vo-you)").getAttribute("id"))!.slice(3);
  await cy.locator(".vo-cell:not(:has(.vo-you))").first().click();
  await host.page.waitForSelector(".screen-voteResult", { timeout: 30000 });
  await expect(host.page.locator(`#vl-${cyId}`), "Cy's picked ballot was counted").toBeAttached();
  await expect(host.page.locator(`#vl-${hostId}`)).toBeAttached();
  await close();
});

test("phone: the accused has the floor, then the class votes (v0.23)", async ({ browser }) => {
  const { host, players, close } = await classroom(browser, ["Bea", "Cy"], 1);
  const [bea, cy] = players.map((p) => p.page);
  for (const p of [host.page, bea, cy]) await answer(p);
  await host.page.waitForSelector("#rv-host", { timeout: 40000 });
  await host.page.click("#rv-host"); // skip Q1's show
  await cy.waitForSelector("#rv-accuse.st-go:not([disabled])", { timeout: 15000 });
  // Cy points at nobody: ACCUSE asks whom (no "Stop pointing"; Cancel backs out).
  await cy.click("#rv-accuse");
  await expect(cy.locator("#pt-sheet h2")).toContainText("Who do you accuse?");
  await expect(cy.locator("#pt-close")).toHaveText("Cancel");
  expect(await cy.locator("#pt-stop").count()).toBe(0);
  const row = cy.locator(".pt-row", { hasText: "Bea" });
  expect((await row.boundingBox())!.height).toBeGreaterThanOrEqual(48);
  await row.click();
  await expect(cy.locator("#pt-sheet")).toHaveCount(0);
  // ACCUSE now names her, with her face: "Accuse Bea? Tap again".
  const beaFace = await host.page.locator('.gb-row[title="Bea"] img.face').getAttribute("src");
  await expect(cy.locator("#rv-accuse.st-confirm")).toBeVisible();
  await expect(cy.locator("#rv-accuse .ac-l.confirm img.face")).toHaveAttribute("src", beaFace!);
  await expect(cy.locator("#rv-accuse")).toHaveAttribute("aria-label", "Accuse Bea? Tap again to confirm.");
  // Picking from ACCUSE also points at her, for everyone to see.
  await expect(host.page.locator(".gb-row", { hasText: "Bea" }).locator(".ptr")).toHaveText("👉1", { timeout: 5000 });
  await cy.waitForTimeout(600);
  await cy.click("#rv-accuse");

  for (const p of [host.page, bea, cy]) await p.waitForSelector(".screen-vote", { timeout: 10000 });
  await expect(cy.locator("#vo-stamp")).toContainText("Bea");
  await expect(cy.locator("#vo-stamp")).toContainText("NO WAY YOU KNEW THAT");
  await expect(host.page.locator(".vo-top")).toContainText("🙋 Cy");
  // Each phone is told what the floor is for: by seat, never by role.
  await expect(bea.locator("#vo-dock-note")).toContainText("You have the floor");
  await expect(cy.locator("#vo-dock-note")).toContainText("Your ballot is in");
  await expect(host.page.locator("#vo-dock-note")).toContainText("Bea has the floor");
  // The accused's card comes first, across both columns.
  const first = host.page.locator(".vo-wrap").first();
  await expect(first).toHaveClass(/accused/);
  const [cardW, gridW] = await Promise.all([first.boundingBox(), host.page.locator(".vo-grid").boundingBox()]).then((b) => b.map((x) => x!.width));
  expect(cardW).toBeGreaterThan(gridW * 0.9);
  // The teacher's ballot stays shut for the 5s floor, then opens.
  const inBeat = async () => (await beatsOf(host.page)).find((b) => /^vote-.*\|in$/.test(b.key))?.wall ?? 0;
  await expect.poll(inBeat, { timeout: 2000 }).toBeGreaterThan(0); // the gavel, after the beat lead
  const voteIn = await inBeat();
  await host.page.waitForTimeout(Math.max(0, voteIn + 4000 - Date.now()));
  expect(await host.page.locator(".vo-cell:not([disabled])").count(), "ballots stay shut while Bea has the floor").toBe(0);
  await expect(host.page.locator(".vo-cell:not([disabled])").first()).toBeVisible({ timeout: Math.max(500, voteIn + 6000 - Date.now()) });
  // Ballots open with a pop, on every phone.
  const heard = () => bea.evaluate(() => (window.__hdykt as unknown as { sounds?: string[] }).sounds ?? []);
  await expect.poll(async () => (await heard()).join(",").split("gavel").at(-1), { timeout: 2000 }).toContain("pop");
  // Cy's ballot is in (no take-backs): the chalk circle is on Bea.
  await expect(cy.locator(".vo-wrap.picked .vo-nm")).toHaveText("Bea");
  await expect(cy.locator("#vo-dock-note")).toContainText("you accused them");
  await host.page.locator('.vo-cell:has(.vo-nm[title="Bea"])').click();
  await host.page.click("#vo-go");
  await host.page.waitForSelector(".screen-voteResult", { timeout: 30000 });
  await expect(host.page.locator(".vr-top")).toContainText("Cy → Bea");
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

  // v0.23: ACCUSE names the 👉 you just picked, not the one the host last
  // echoed. Bea points at Hana and the host's state says so; then she
  // re-points at Sam and taps ACCUSE in one go, before any state can land.
  await bea.click("#rv-point");
  await bea.locator(".pt-row", { hasText: "Hana" }).click();
  await expect(bea.locator("#rv-point")).toHaveAttribute("aria-label", "Pointing at Hana. Change");
  await bea.waitForTimeout(800); // past the 350ms coalescing and the round trip
  await bea.evaluate(() => {
    const tap = (el: Element | null | undefined) => (el as HTMLElement).click();
    tap(document.querySelector("#rv-point"));
    tap([...document.querySelectorAll(".pt-row")].find((r) => r.textContent!.includes("Sleepy Sam")));
    tap(document.querySelector("#rv-accuse"));
  });
  await expect(bea.locator("#rv-accuse")).toHaveAttribute("aria-label", "Accuse Sleepy Sam? Tap again to confirm.");
  await expect(bea.locator("#rv-point")).toHaveAttribute("aria-label", "Pointing at Sleepy Sam. Change");
  await bea.waitForTimeout(800); // the host's state catches up: still Sam
  await expect(bea.locator("#rv-accuse")).toHaveAttribute("aria-label", "Accuse Sleepy Sam? Tap again to confirm.");
  await close();
});

test("phone: your report card counts a finished period once, across a reload", async ({ browser }) => {
  // Bea is the cheater (local test hook); the class catches her after Q1.
  const host = await phone(browser, "/?debugCheater=Bea");
  await host.page.fill("#playerName", "Hana");
  await host.page.click("#hm-next");
  await host.page.click('[data-action="create"]');
  const code = (await host.page.locator(".roomcode").innerText({ timeout: 15000 })).replace(/\s/g, "");
  const join = async (name: string) => {
    const p = await phone(browser, `/#/join/${code}`);
    await p.page.fill("#playerName", name);
    await p.page.click("#hm-next");
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
  // v0.23: Cy names Bea from the sheet; his ballot goes in with it.
  await cy.page.click("#rv-accuse");
  await cy.page.locator(".pt-row", { hasText: "Bea" }).click();
  await cy.page.waitForTimeout(600); // a deliberate confirm, not a fumble
  await cy.page.click("#rv-accuse");
  const vote = async (p: Page, whom: string) => {
    await p.waitForSelector(".screen-vote", { timeout: 15000 });
    await p.locator(`.vo-cell:has(.vo-nm[title="${whom}"])`).click(); // waits out Bea's floor
    await p.click("#vo-go");
  };
  await vote(host.page, "Bea");
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
  await again.click("#hm-next"); // v0.21: the invite's Join
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
  await host.page.click("#hm-next");
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

type VoiceLine = { id: string; at: number; hit: number; end: number; heard: boolean; cut?: number };
const voiceOf = (page: Page) => page.evaluate(() => (window as unknown as { __hdykt?: { voice?: VoiceLine[] } }).__hdykt?.voice ?? []);
const beatsOf = (page: Page) => page.evaluate(() => window.__hdykt?.beats ?? []);

test("big screen: a game-show host voices the night, from the TV only (v0.19)", async ({ browser }) => {
  const host = await phone(browser);
  const phoneClips: string[] = [];
  host.page.on("request", (r) => {
    if (r.url().includes("/voice/")) phoneClips.push(r.url());
  });
  await host.page.fill("#playerName", "Hana");
  await host.page.click("#hm-next");
  await host.page.click('[data-action="create"]');
  const code = (await host.page.locator(".roomcode").innerText({ timeout: 15000 })).replace(/\s/g, "");
  const tvCtx = await browser.newContext({ viewport: { width: 1280, height: 720 }, isMobile: false, hasTouch: false });
  const tv = await tvCtx.newPage();
  await tv.goto(`/#/tv/${code}`);
  await expect(tv.locator("#lb-tvjoin")).toBeVisible({ timeout: 15000 });
  await tv.waitForFunction(() => (window as unknown as { __hdykt?: { voiceReady?: boolean } }).__hdykt?.voiceReady === true, null, { timeout: 30000 });
  // She greets the room as soon as the TV may play sound: on a real TV after
  // the first click or key (the browser's rule), here at once.
  await tv.keyboard.press("Enter");
  await expect.poll(async () => (await voiceOf(tv)).map((v) => v.id), { timeout: 5000 }).toContain("welcome");
  // V mutes her from homeroom too (the lobby's own toast lives in a dock the TV hides).
  await tv.keyboard.press("v");
  await expect(tv.getByText("Host voice off")).toBeVisible();
  await tv.keyboard.press("v");
  await expect(tv.getByText("Host voice on")).toBeVisible();

  for (let i = 0; i < 2; i++) {
    await host.page.click("#lb-addbot");
    await host.page.waitForTimeout(120);
  }
  await host.page.click("#lb-start");
  await expect(tv.locator(".screen-question")).toBeVisible({ timeout: 30000 });
  await answer(host.page);
  await expect(tv.locator(".screen-reveal")).toBeVisible({ timeout: 40000 });
  const lit = () =>
    beatsOf(tv).then((b) => b.find((x) => x.key.startsWith("reveal-1-0|") && x.key.split("|")[1].split(",").includes("answer")));
  await expect.poll(lit, { timeout: 15000 }).toBeTruthy();
  const answerLit = (await lit())!.server;
  const correct = Number((await tv.locator(".ob-row.is-correct").first().getAttribute("id"))!.slice(3));
  const beats = await beatsOf(tv);
  const voice = await voiceOf(tv);
  const ids = voice.map((v) => v.id);

  // The bell holds for her intro when a big screen is in the room, then she calls question one.
  const bell = beats.find((b) => b.key.startsWith("role-1-0|"))!.server;
  const q1 = beats.find((b) => b.key.startsWith("question-1-0|"))!.server;
  expect(q1 - bell).toBeGreaterThan(6000);
  expect(q1 - bell).toBeLessThan(7000);
  expect(ids.indexOf("period_first")).toBeGreaterThan(-1);
  expect(ids.indexOf("q1")).toBeGreaterThan(ids.indexOf("period_first"));
  // The answer call says the right letter, and the letter lands as it lights up.
  const call = voice.find((v) => /^(answer|quick)_[a-d]$/.test(v.id))!;
  expect(call, `an answer call in ${ids.join(", ")}`).toBeTruthy();
  expect(call.id.slice(-1)).toBe("abcd"[correct]);
  expect(Math.abs(call.hit - answerLit)).toBeLessThan(80);
  // Heard (audio unlocked), one voice at a time.
  expect(voice.every((v) => v.heard)).toBe(true);
  for (let i = 1; i < voice.length; i++) {
    const prev = voice[i - 1];
    expect(voice[i].at, `${voice[i].id} starts over ${prev.id}`).toBeGreaterThanOrEqual(Math.min(prev.end, prev.cut ?? Infinity) - 40);
  }

  // V on the TV's keyboard sends her off: the next question passes in silence.
  await tv.keyboard.press("v");
  await expect(tv.getByText("Host voice off")).toBeVisible();
  const said = (await voiceOf(tv)).length;
  await host.page.locator('#rv-host[data-action="advance"]:not([disabled])').click({ timeout: 20000 });
  await expect(tv.locator(".screen-question")).toBeVisible({ timeout: 15000 });
  await tv.waitForTimeout(1500);
  expect((await voiceOf(tv)).length).toBe(said);
  await tv.keyboard.press("v");
  await expect(tv.getByText("Host voice on")).toBeVisible();

  // The phones: never a clip, never a line.
  expect(phoneClips).toEqual([]);
  expect(await voiceOf(host.page)).toEqual([]);
  await tvCtx.close();
  await host.ctx.close();
});

type TutorialState = { voiced: boolean; total: number };
const tutorialOf = (page: Page) => page.evaluate(() => (window as unknown as { __hdykt?: { tutorial?: TutorialState } }).__hdykt?.tutorial ?? null);

test("how to play: Home's one-minute video plays with her voice and captions, and closes (v0.20)", async ({ browser }) => {
  const { ctx, page } = await phone(browser);
  await page.click("#hm-howto");
  const tut = page.locator("#tut");
  await expect(tut).toBeVisible();
  await expect.poll(() => tutorialOf(page), { timeout: 10000 }).toMatchObject({ voiced: true });
  expect((await tutorialOf(page))!.total).toBeGreaterThan(55_000);
  // The stage fits the phone: nothing sticks out sideways.
  const box = (await page.locator(".tut-stage").boundingBox())!;
  expect(box.width).toBeLessThanOrEqual(SE.width + 1);
  expect(box.height).toBeLessThanOrEqual(SE.height + 1);
  // Captions follow her words; the word being said is marked.
  await expect(page.locator(".tut-cap-box span.now")).toHaveCount(1, { timeout: 5000 });
  await expect(page.locator(".tut-cap-box")).toContainText("Welcome");
  // Closing gives the page back, focus on the button that opened it.
  await page.click(".tut-close");
  await expect(tut).toHaveCount(0);
  await expect(page.locator("#hm-howto")).toBeFocused();
  await ctx.close();
});

test("how to play: the big screen plays it after the welcome, the way in beside it; the bell ends it (v0.20)", async ({ browser }) => {
  const host = await phone(browser);
  await host.page.fill("#playerName", "Hana");
  await host.page.click("#hm-next");
  await host.page.click('[data-action="create"]');
  const code = (await host.page.locator(".roomcode").innerText({ timeout: 15000 })).replace(/\s/g, "");
  const tvCtx = await browser.newContext({ viewport: { width: 1280, height: 720 }, isMobile: false, hasTouch: false });
  const tv = await tvCtx.newPage();
  await tv.goto(`/#/tv/${code}`);
  await expect(tv.locator("#lb-tvjoin")).toBeVisible({ timeout: 15000 });
  await tv.waitForFunction(() => (window as unknown as { __hdykt?: { voiceReady?: boolean } }).__hdykt?.voiceReady === true, null, { timeout: 30000 });
  await tv.keyboard.press("Enter");
  await expect.poll(async () => (await voiceOf(tv)).map((v) => v.id), { timeout: 5000 }).toContain("welcome");
  // ~9s later, once she has welcomed the room: how to play, with the QR and the code beside it.
  await expect(tv.locator("#tut")).toBeVisible({ timeout: 15000 });
  await expect(tv.locator("#tut .tut-side .code")).toHaveText(code);
  await expect(tv.locator("#tut .tut-side .qr svg")).toBeVisible();
  await expect(tv.locator("#tut .tut-side .who")).toContainText("Hana");
  await expect(tv.locator(".tut-close")).toHaveCount(0); // nothing to tap on a TV
  await expect.poll(() => tutorialOf(tv), { timeout: 10000 }).toMatchObject({ voiced: true });
  // The teacher rings the bell: the big screen goes straight to the class.
  for (let i = 0; i < 2; i++) {
    await host.page.click("#lb-addbot");
    await host.page.waitForTimeout(120);
  }
  await host.page.click("#lb-start");
  await expect(tv.locator("#tut")).toHaveCount(0, { timeout: 10000 });
  await expect(tv.locator(".screen-role, .screen-question")).toBeVisible({ timeout: 15000 });
  // H plays it again, but only in homeroom.
  await tv.keyboard.press("h");
  await tv.waitForTimeout(400);
  await expect(tv.locator("#tut")).toHaveCount(0);
  await tvCtx.close();
  await host.ctx.close();
});

test("phone: someone arriving mid-period watches from the hallway, without answering", async ({ browser }) => {
  const { host, code, close } = await classroom(browser, [], 3);
  await host.page.waitForSelector("button.opt:not([disabled])", { timeout: 30000 });
  const late = await phone(browser, `/#/join/${code}`);
  await late.page.fill("#playerName", "Eve");
  await late.page.click("#hm-next");
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
  await host.page.click("#hm-next");
  await host.page.click('[data-action="create"]');
  const code = (await host.page.locator(".roomcode").innerText({ timeout: 15000 })).replace(/\s/g, "");
  const guest = await phone(browser, `/#/join/${code}`);
  await guest.page.fill("#playerName", "Bea");
  await guest.page.click("#hm-next");
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
  await page.click("#hm-next");
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
/** v0.26: the curve changes each tape's path, so some moments are found by
 *  what happens in them. A question the class ran to the bell (pencils down),
 *  in whichever tape has one first. */
function timedOutQuestion(): { fixture: string; t: number } {
  type Q = { phase: string; phaseStartedAt: number; match: { questionIdx: number; question?: { deadline: number } | null; reveal?: { startedAt: number } | null } | null };
  for (const fixture of ["caught", "graduated", "topscore", "struckout", "detention", "fullclass"]) {
    const t = JSON.parse(readFileSync(`client/public/fixtures/${fixture}.json`, "utf8")) as { t0: number; frames: { state: Q }[] };
    for (const f of t.frames) {
      if (f.state.phase !== "question" || !f.state.match?.question) continue;
      const i = f.state.match.questionIdx;
      const r = t.frames.find((x) => x.state.phase === "reveal" && x.state.match?.questionIdx === i && x.state.match.reveal);
      if (r && r.state.match!.reveal!.startedAt >= f.state.match.question.deadline) return { fixture, t: Math.round(f.state.phaseStartedAt - t.t0) };
    }
  }
  throw new Error("no question ran to the bell in any tape");
}
/** The last reveal (any tape) with a CLEARED classmate, seen by someone else. */
function clearedRevealMoment(): { fixture: string; t: number; as: string } {
  type R = { phase: string; phaseStartedAt: number; match: { cleared: string[]; reveal?: { startedAt: number } | null } | null; players: { id: string; name: string; banished: boolean }[] };
  for (const fixture of ["struckout", "graduated", "detention", "caught", "topscore", "fullclass"]) {
    const t = JSON.parse(readFileSync(`client/public/fixtures/${fixture}.json`, "utf8")) as { t0: number; frames: { state: R }[] };
    const f = [...t.frames].reverse().find((x) => x.state.phase === "reveal" && x.state.match?.reveal && x.state.match.cleared.length > 0);
    if (!f) continue;
    const viewer = f.state.players.find((p) => !f.state.match!.cleared.includes(p.id) && !p.banished)!;
    return { fixture, t: Math.round(f.state.match!.reveal!.startedAt - t.t0) + 7600, as: viewer.name.toLowerCase() };
  }
  throw new Error("no tape has a CLEARED classmate on a reveal");
}
function phaseAt(name: string, phase: string, qi?: number): number {
  const t = JSON.parse(readFileSync(`client/public/fixtures/${name}.json`, "utf8")) as Tape;
  const f = t.frames.find((x) => x.state.phase === phase && (qi === undefined || x.state.match?.questionIdx === qi))!;
  return Math.round(f.state.phaseStartedAt - t.t0);
}

test("phone: game-show sound plays on the beats, the same for the cheater, and one switch silences it", async ({ browser }) => {
  const bell = timedOutQuestion(); // a question the class ran to the bell, then its reveal
  const fx = bell.fixture;
  const from = bell.t + 9000;
  const hear = async (view: string) => {
    const { ctx, page } = await phone(browser, `/#/fixture/${fx}?as=cheater${view}&t=${from}&ui=0`);
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
  const { ctx, page } = await phone(browser, `/#/fixture/${fx}?as=innocent&t=-1500&paused=1&ui=0`);
  await page.waitForFunction(() => !!window.__fixture);
  await page.click("#snd-lb-snd");
  await expect(page.locator("#snd-lb-snd")).toHaveAttribute("aria-pressed", "false");
  await page.goto(`/#/fixture/${fx}?as=innocent&t=${from}&ui=0`);
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

test("phone: the 👉 sheet keeps every name readable, CLEARED and a crowd included (v0.23)", async ({ browser }) => {
  // A late reveal with a CLEARED classmate (v0.26: found in whichever tape has
  // one), seen by someone else. The accuse sheet uses the same rows.
  const m = clearedRevealMoment();
  const { ctx, page } = await phone(browser, `/#/fixture/${m.fixture}?as=${encodeURIComponent(m.as)}&t=${m.t}&paused=1&ui=0`);
  await page.waitForFunction(() => !!window.__fixture);
  await page.waitForTimeout(800);
  await page.click("#rv-point");
  const rows = await page.locator(".pt-row").evaluateAll((els) =>
    els.map((r) => ({ name: r.querySelector(".pt-nm")!.textContent, w: r.querySelector(".pt-nm")!.getBoundingClientRect().width, cleared: !!r.querySelector(".badge.cleared"), fits: r.scrollWidth <= r.clientWidth })),
  );
  expect(rows.some((r) => r.cleared), "the tape still has a CLEARED classmate").toBe(true);
  for (const r of rows) {
    expect(r.w, `${r.name}'s name is squeezed`).toBeGreaterThanOrEqual(40);
    expect(r.fits, `${r.name}'s row spills`).toBe(true);
  }
  await ctx.close();
});

test("phone: no field small enough for iOS to zoom; nothing scrolls sideways at 320px", async ({ browser }) => {
  const urls = [
    "/",
    "/#/join/ABCDE",
    "/#/fixture/fullclass?as=innocent&t=-1500&paused=1&ui=0&host=1",
    `/#/fixture/fullclass?as=innocent&t=${phaseAt("fullclass", "question", 7) + 3000}&paused=1&ui=0`,
    `/#/fixture/fullclass?as=innocent&t=${phaseAt("fullclass", "reveal", 4) + 9500}&paused=1&ui=0`,
    `/#/fixture/fullclass?as=innocent&t=${phaseAt("fullclass", "vote") + 3000}&paused=1&ui=0`, // the accused's floor
    `/#/fixture/fullclass?as=innocent&t=${phaseAt("fullclass", "vote") + 7000}&paused=1&ui=0`, // v0.23: ballots open
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

test("home: you first (name and student), then where to; the back gesture returns (v0.21)", async ({ browser }) => {
  const { ctx, page } = await phone(browser);
  // Step 1: the class photo, sixteen portraits, every one loaded. No code box yet.
  await expect(page.locator(".av-pick img.face")).toHaveCount(16);
  await expect
    .poll(() => page.evaluate(() => [...document.querySelectorAll<HTMLImageElement>(".av-pick img.face")].every((i) => i.complete && i.naturalWidth > 0)))
    .toBe(true);
  expect(await page.locator("#joinCode").count()).toBe(0);
  // Next with no name: the sticker asks for one, and the ask goes once it has one.
  await page.click("#hm-next");
  await expect(page.locator(".hm-err")).toContainText("name tag");
  await page.fill("#playerName", "Maya");
  await expect(page.locator(".hm-err")).toHaveCount(0);
  await page.click('[data-av="🧪"]');
  await expect(page.locator(".hm-nick")).toHaveText("The Mad Scientist");
  await expect(page.locator(".hello-av img.face")).toHaveAttribute("src", /testtube\.webp$/);
  await expect(page.locator('[data-av="🧪"]')).toHaveAttribute("aria-pressed", "true");
  // Step 2: you in a nutshell, then join, start or practice.
  await page.click("#hm-next");
  await expect(page.locator("#hm-me .hm-me-name")).toHaveText("Maya");
  await expect(page.locator("#hm-me img.face")).toHaveAttribute("src", /testtube\.webp$/);
  await expect(page.locator('[data-action="join"]')).toBeVisible();
  await expect(page.locator('[data-action="create"]')).toBeVisible();
  await expect(page.locator("#hm-practice")).toBeVisible();
  // The phone's back gesture returns to step 1 (not out of the game), name and pick kept.
  await page.goBack();
  await expect(page.locator("#playerName")).toHaveValue("Maya");
  await expect(page.locator('[data-av="🧪"]')).toHaveClass(/sel/);
  // Change does too.
  await page.click("#hm-next");
  await page.click("#hm-change");
  await expect(page.locator("#playerName")).toBeVisible();
  expect(await page.evaluate(() => [localStorage.getItem("hdykt-name"), localStorage.getItem("hdykt-avatar")])).toEqual(["Maya", "🧪"]);
  await ctx.close();
});

test("an avatar that isn't one of the students never reaches anyone's screen (v0.21)", async ({ browser }) => {
  const host = await phone(browser);
  await host.page.fill("#playerName", "Hana");
  await host.page.click("#hm-next");
  await host.page.click('[data-action="create"]');
  const code = (await host.page.locator(".roomcode").innerText({ timeout: 15000 })).replace(/\s/g, "");
  // A hand-rolled client skips the game's own checks and sends markup.
  const sock = io(new URL(host.page.url()).origin, { transports: ["websocket"] });
  const forged = '<img src=x onerror="window.__pwned=1">';
  await new Promise<void>((resolve, reject) =>
    sock.emit("join", { code, name: "Mallory", avatar: forged }, (res: { ok: boolean }) => (res.ok ? resolve() : reject(new Error("join failed")))),
  );
  const row = host.page.locator(".lb-row", { hasText: "Mallory" });
  await expect(row).toBeVisible({ timeout: 10000 });
  // The host gave them one of the students instead.
  await expect(row.locator("img.face")).toHaveAttribute("src", /\/avatars\/\w+\.webp$/);
  expect(await host.page.locator('img[src="x"]').count()).toBe(0);
  expect(await host.page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned ?? 0)).toBe(0);
  sock.disconnect();
  await host.ctx.close();
});

test("one face per desk: a student someone already has goes to someone else, who is told once (v0.24)", async ({ browser }) => {
  const host = await phone(browser);
  await host.page.fill("#playerName", "Hana");
  await host.page.click('[data-av="🎒"]');
  await host.page.click("#hm-next");
  await host.page.click('[data-action="create"]');
  const code = (await host.page.locator(".roomcode").innerText({ timeout: 15000 })).replace(/\s/g, "");
  // Bea and Cy both pick the Bookworm on Home.
  const join = async (name: string) => {
    const p = await phone(browser, `/#/join/${code}`);
    await p.page.fill("#playerName", name);
    await p.page.click('[data-av="📚"]');
    await p.page.click("#hm-next");
    await p.page.waitForSelector(".screen-lobby");
    return p;
  };
  const bea = await join("Bea");
  const cy = await join("Cy");
  // The teacher's attendance list: two different students, Bea first come, first served.
  const face = (name: string) => host.page.locator(`.lb-row:has(.nm[title="${name}"]) .lb-av img.face`);
  await expect(face("Cy")).toBeVisible({ timeout: 10000 });
  await expect(face("Bea")).toHaveAttribute("src", /books\.webp$/);
  expect(await face("Cy").getAttribute("src")).not.toMatch(/books\.webp$/);
  // Cy is told who he is today; Bea, who got her pick, isn't told anything.
  await expect(cy.page.locator(".lb-toast")).toContainText(/^The Bookworm was taken, so you're the [A-Z][\w' -]+ today\.$/);
  expect(await bea.page.locator(".lb-toast").count()).toBe(0);
  // His own pick stays saved for next time, and a reload doesn't say it again.
  expect(await cy.page.evaluate(() => localStorage.getItem("hdykt-avatar"))).toBe("📚");
  await cy.page.reload();
  await cy.page.waitForSelector(".screen-lobby", { timeout: 15000 });
  await cy.page.waitForTimeout(800);
  expect(await cy.page.locator(".lb-toast").count()).toBe(0);
  for (const p of [host, bea, cy]) await p.ctx.close();
});

test("a taken name goes back to the name tag, with a free one to join as in one tap (v0.24)", async ({ browser }) => {
  const host = await phone(browser);
  await host.page.fill("#playerName", "Hana");
  await host.page.click("#hm-next");
  await host.page.click('[data-action="create"]');
  const code = (await host.page.locator(".roomcode").innerText({ timeout: 15000 })).replace(/\s/g, "");
  const bea = await phone(browser, `/#/join/${code}`);
  await bea.page.fill("#playerName", "Bea");
  await bea.page.click("#hm-next");
  await bea.page.waitForSelector(".screen-lobby");
  // A second Bea types the code on step 2…
  const twin = await phone(browser);
  await twin.page.fill("#playerName", "Bea");
  await twin.page.click("#hm-next");
  await twin.page.fill("#joinCode", code);
  await twin.page.click('[data-action="join"]');
  // …and lands on step 1, where the name is, not on the code: what's wrong
  // and the fix, both in view on an SE.
  await expect(twin.page.locator(".hm-err")).toContainText('"Bea" is already in this room');
  await expect(twin.page.locator("#playerName")).toBeVisible();
  expect(await twin.page.locator("#joinCode").count()).toBe(0);
  const fix = twin.page.locator("#hm-suggest");
  await expect(fix).toHaveText("Join as Bea 2");
  for (const el of [twin.page.locator(".hm-err"), fix]) {
    const box = (await el.boundingBox())!;
    expect(box.y + box.height, "in view on an SE").toBeLessThanOrEqual(SE.height);
  }
  expect((await fix.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  expect(await twin.page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)).toBe(false);
  // One tap: in the class as "Bea 2", and that's the name saved for next time.
  await fix.click();
  await twin.page.waitForSelector(".screen-lobby", { timeout: 15000 });
  await expect(host.page.locator('.lb-row .nm[title="Bea 2"]')).toBeVisible({ timeout: 10000 });
  expect(await twin.page.evaluate(() => localStorage.getItem("hdykt-name"))).toBe("Bea 2");
  // From an invite link it's the same: the next free number, ignoring case.
  const third = await phone(browser, `/#/join/${code}`);
  await third.page.fill("#playerName", "bea");
  await third.page.click("#hm-next");
  await expect(third.page.locator("#hm-suggest")).toHaveText("Join as bea 3");
  // Rubbing the name out puts the offer away for good: the next error on the
  // name tag ("write your name") doesn't bring it back.
  await third.page.fill("#playerName", "");
  await third.page.click("#hm-next");
  await expect(third.page.locator(".hm-err")).toContainText("name tag");
  await expect(third.page.locator("#hm-suggest")).toHaveCount(0);
  for (const p of [host, bea, twin, third]) await p.ctx.close();
});

test("back on a new tab mid-match: told to wait for the report card, with no other name to split into (v0.24)", async ({ browser }) => {
  const { host, players, code, close } = await classroom(browser, ["Bea"], 2);
  const bea = players[0];
  await bea.page.waitForSelector("button.opt:not([disabled])", { timeout: 30000 });
  // The phone threw her tab away; she taps the invite again. The new tab has
  // her saved name, but not the seat's token (that's per tab).
  await bea.page.close();
  await expect(host.page.locator('.qz-desk.off[title^="Bea"]')).toBeAttached({ timeout: 10000 });
  const again = await bea.ctx.newPage();
  await again.goto(`/#/join/${code}`);
  await expect(again.locator("#playerName")).toHaveValue("Bea");
  await again.click("#hm-next");
  // Her seat is held for her: back on the name tag with the advice, and no
  // "Join as Bea 2" that would make her a second classmate.
  await expect(again.locator(".hm-err")).toContainText("is mid-match");
  await expect(again.locator("#playerName")).toBeVisible();
  await expect(again.locator("#hm-suggest")).toHaveCount(0);
  expect(await again.evaluate(() => localStorage.getItem("hdykt-name"))).toBe("Bea");
  await close();
});

// ---- v0.25 Tomatoes! ----

test("phone: tomatoes and applause after the unmask reach every phone and the big screen (v0.25)", async ({ browser }) => {
  // Bea is the cheater (local test hook) and graduates at Q2 on a 400 line
  // (v0.26: Q1 is medium, 200; Q2 is medium or harder, since she's right), so
  // no accusation is needed to reach the report card.
  const host = await phone(browser, "/?debugCheater=Bea");
  await host.page.fill("#playerName", "Hana");
  await host.page.click("#hm-next");
  await host.page.click('[data-action="create"]');
  const code = (await host.page.locator(".roomcode").innerText({ timeout: 15000 })).replace(/\s/g, "");
  await host.page.click("#lb-adv summary");
  await host.page.fill("#set-line", "400");
  await host.page.locator("#set-line").blur();
  await expect(host.page.locator(".lb-adv-sum")).toContainText("line 400");
  const tvCtx = await browser.newContext({ viewport: { width: 1280, height: 720 }, isMobile: false, hasTouch: false });
  const tv = await tvCtx.newPage();
  await tv.goto(`/#/tv/${code}`);
  await expect(tv.locator("#lb-tvjoin")).toBeVisible({ timeout: 15000 });
  const join = async (name: string) => {
    const p = await phone(browser, `/#/join/${code}`);
    await p.page.fill("#playerName", name);
    await p.page.click("#hm-next");
    await p.page.waitForSelector(".screen-lobby");
    return p;
  };
  const bea = await join("Bea");
  const cy = await join("Cy");
  const pages = [host.page, bea.page, cy.page, tv];
  const errors: string[] = [];
  for (const p of pages) p.on("pageerror", (e) => errors.push(e.message));
  await host.page.click("#lb-start");
  // Watch every screen for the cluster showing up before the unmask.
  for (const p of pages) {
    await p.evaluate(() => {
      const w = window as unknown as { __early: { masked: number; cheer: number } };
      w.__early = { masked: 0, cheer: 0 };
      const look = () => {
        const sec = document.querySelector(".screen-matchEnd");
        if (sec && !sec.classList.contains("b-unmask")) {
          w.__early.masked++;
          if (sec.querySelector(".me-cheer")) w.__early.cheer++;
        }
        requestAnimationFrame(look);
      };
      look();
    });
  }
  const cheat = () => bea.page.locator("button.opt.cheat-mark:not([disabled])").click({ timeout: 30000 });
  await cheat();
  await answer(host.page);
  await answer(cy.page);
  await host.page.click("#rv-host", { timeout: 40000 }); // skip the show…
  await host.page.locator('#rv-host[data-action="advance"]:not([disabled])').click({ timeout: 20000 }); // …and on to Q2
  await cheat();
  await answer(host.page);
  await answer(cy.page);
  for (const p of pages) await p.waitForSelector(".screen-matchEnd.v-graduated", { timeout: 30000 });

  // From the unmask: the buttons on every phone (the cheater's too), only the count on the TV.
  await expect(cy.page.locator("#me-tomato")).toBeVisible({ timeout: 5000 });
  for (const p of [host.page, bea.page]) await expect(p.locator("#me-tomato")).toBeVisible();
  await expect(tv.locator("#me-cheer-count")).toBeVisible();
  expect(await tv.locator(".me-cheer-btn").count(), "the big screen never throws").toBe(0);
  for (const p of pages) {
    const early = await p.evaluate(() => (window as unknown as { __early: { masked: number; cheer: number } }).__early);
    expect(early.masked, "the report card was seen before the unmask").toBeGreaterThan(0);
    expect(early.cheer, "no tomatoes before the unmask").toBe(0);
  }
  expect((await cy.page.locator("#me-tomato").boundingBox())!.width).toBeGreaterThanOrEqual(52);

  const sounds = (p: Page) => p.evaluate(() => (window.__hdykt as unknown as { sounds?: string[] }).sounds ?? []);
  const clicks = async (p: Page) => (await sounds(p)).filter((x) => x === "click").length;
  const cyClicks = await clicks(cy.page);
  for (let i = 0; i < 3; i++) {
    await cy.page.click("#me-tomato");
    await cy.page.waitForTimeout(300);
  }
  await host.page.click("#me-clap");
  for (const p of pages) await expect(p.locator("#me-cheer-count"), "every screen counts the same").toHaveText("🍅 3 · 👏 1", { timeout: 1500 });
  // The hits land: on the big screen (with a thump) and on the cheater's own phone.
  await expect.poll(() => tv.locator("#cheers .ch-fly, #cheers .ch-pop, #cheers-pin .ch-splat, #cheers-pin .ch-pop").count(), { timeout: 3000 }).toBeGreaterThan(0);
  await expect.poll(() => tv.locator("#cheers-pin .ch-splat").count(), { timeout: 3000 }).toBeGreaterThan(0);
  await expect.poll(() => bea.page.locator("#cheers-pin .ch-splat").count(), { timeout: 3000 }).toBeGreaterThan(0);
  await expect.poll(async () => (await sounds(tv)).includes("splat"), { timeout: 3000 }).toBe(true);
  // A phone hears its own throws only, one click each: other people's hits land in silence.
  expect(await clicks(cy.page), "one click per throw").toBe(cyClicks + 3);
  for (const p of [host.page, bea.page, cy.page]) {
    const heard = await sounds(p);
    expect(heard.filter((x) => x === "splat" || x === "clap"), "no hit sounds on phones").toEqual([]);
  }
  // Cy's own three splat once each: their echo in the count throws nothing more.
  await cy.page.waitForTimeout(1500);
  expect(await cy.page.locator("#cheers-pin .ch-splat").count(), "a phone's own tomatoes aren't thrown twice").toBe(3);
  // The same markup for the cheater as for anyone else.
  expect(await bea.page.locator("#me-cheer").innerHTML()).toBe(await cy.page.locator("#me-cheer").innerHTML());
  // The big screen's count stays clear of its "click for sound" hint.
  expect(await tv.locator("#tv-sound").count(), "nobody has clicked the big screen").toBe(1);
  const chipClear = await tv.evaluate(() => {
    const a = document.getElementById("me-cheer-count")!.getBoundingClientRect();
    const b = document.getElementById("tv-sound")!.getBoundingClientRect();
    return a.width > 0 && (a.bottom <= b.top || b.bottom <= a.top || a.right <= b.left || b.right <= a.left);
  });
  expect(chipClear, "the big screen's count isn't under the sound hint").toBe(true);

  // The big screen rolls down the long report on its own… until a tomato
  // brings it back to the photo, where it holds while the room throws.
  const faceTop = () => tv.evaluate(() => document.getElementById("me-face-real")?.getBoundingClientRect().top ?? 0);
  await expect.poll(faceTop, { timeout: 40000, intervals: [500] }).toBeLessThan(0);
  const tvSplats = await tv.locator("#cheers-pin .ch-splat").count();
  await cy.page.click("#me-tomato");
  await expect.poll(() => tv.evaluate(() => scrollY), { timeout: 2000 }).toBe(0);
  await expect.poll(() => tv.locator("#cheers-pin .ch-splat").count(), { timeout: 3000 }).toBe(tvSplats + 1);
  await tv.waitForTimeout(3000);
  expect(await tv.evaluate(() => scrollY), "…and holds on the photo while the room throws").toBe(0);

  // Back to homeroom: every screen's tomatoes are swept up.
  await host.page.click("#me-advance");
  for (const p of pages) {
    await p.waitForSelector(".screen-lobby", { timeout: 15000 });
    expect(await p.locator("#cheers > :not(.ch-probe), #cheers-pin .ch-pin > *").count(), "nothing left in homeroom").toBe(0);
  }
  expect(errors).toEqual([]);
  await tvCtx.close();
  for (const p of [host, bea, cy]) await p.ctx.close();
});

test("phone: the cheer rail clears the scores and the teacher's dock; reduced motion lands without a flight (v0.25)", async ({ browser }) => {
  const end = (name: string) => phaseAt(name, "matchEnd");
  // Before the unmask (caught: 2.5s in) there is nothing to throw.
  {
    const { ctx, page } = await phone(browser, `/#/fixture/caught?as=cheater&t=${end("caught") + 1200}&paused=1&ui=0`);
    await page.waitForFunction(() => !!window.__fixture);
    await page.waitForTimeout(600);
    expect(await page.locator(".me-cheer").count()).toBe(0);
    await ctx.close();
  }
  // At rest (no scrolling), every ending on an SE, guest and teacher, and a
  // short 320px phone: the rail's chip and buttons hide nothing to read.
  const rest: [string, { width: number; height: number }][] = [];
  for (const fx of ["caught", "graduated", "fullclass", "struckout", "detention", "topscore"])
    for (const host of ["", "&host=1"]) rest.push([`/#/fixture/${fx}?as=innocent&t=${end(fx) + 7500}&paused=1&ui=0${host}`, SE]);
  rest.push([`/#/fixture/caught?as=innocent&t=${end("caught") + 7500}&paused=1&ui=0&host=1`, { width: 320, height: 460 }]);
  rest.push([`/#/fixture/detention?as=innocent&t=${end("detention") + 7500}&paused=1&ui=0`, { width: 320, height: 460 }]);
  for (const [url, size] of rest) {
    const { ctx, page } = await phone(browser, url, size);
    await page.waitForFunction(() => !!window.__fixture);
    await page.waitForTimeout(1200);
    const r = await page.evaluate(() => {
      const box = (el: Element) => el.getBoundingClientRect();
      const hits = (a: DOMRect, b: DOMRect) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
      const rail = box(document.querySelector("#me-cheer")!);
      const parts = [...document.querySelectorAll("#me-cheer-count, .me-cheer-btn")].map(box);
      const read = ".me-score, .me-trophy, .me-aside, .me-nm, #me-hero .me-fx, #me-name, #me-sub, #me-advance, #me-endday";
      const covered = [...document.querySelectorAll(read)]
        .filter((el) => box(el).height > 0 && parts.some((p) => hits(p, box(el))))
        .map((el) => `${el.id || el.className} "${(el.textContent ?? "").trim().slice(0, 24)}"`);
      return { covered, inView: rail.bottom <= innerHeight && rail.right <= innerWidth, overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1 };
    });
    expect(r.covered, `${url} at ${size.width}px: the rail covers these`).toEqual([]);
    expect(r.inView && !r.overflow, `${url} at ${size.width}px: on screen, nothing sideways`).toBe(true);
    await ctx.close();
  }
  // A tap throws one at once (in a replay too, where nothing is sent): it
  // flies (a transform), then splats on the photo…
  {
    const { ctx, page } = await phone(browser, `/#/fixture/caught?as=innocent&t=${end("caught") + 4500}&paused=1&ui=0`);
    await page.waitForFunction(() => !!window.__fixture);
    await page.waitForTimeout(800);
    await page.click("#me-tomato");
    await expect(page.locator("#cheers .ch-fly")).toHaveCount(1);
    await expect(page.locator("#cheers-pin .ch-splat")).toHaveCount(1, { timeout: 2000 });
    await expect(page.locator("#cheers .ch-fly")).toHaveCount(0);
    // …sitting on the cheater's photo.
    const [splat, face] = await Promise.all([page.locator("#cheers-pin .ch-splat").boundingBox(), page.locator("#me-face-real").boundingBox()]);
    const [cx, cy] = [splat!.x + splat!.width / 2, splat!.y + splat!.height / 2];
    expect(cx > face!.x && cx < face!.x + face!.width && cy > face!.y && cy < face!.y + face!.height, "the splat lands on the photo").toBe(true);
    await ctx.close();
  }
  // …and with reduced motion it just appears there: no flight, nothing moves.
  {
    const ctx = await browser.newContext({ viewport: SE, isMobile: true, hasTouch: true, reducedMotion: "reduce" });
    const page = await ctx.newPage();
    await page.goto(`/#/fixture/caught?as=innocent&t=${end("caught") + 4500}&paused=1&ui=0`);
    await page.waitForFunction(() => !!window.__fixture);
    await page.waitForTimeout(800);
    await page.click("#me-tomato");
    await page.waitForTimeout(400); // past the tap gap
    await page.click("#me-clap");
    expect(await page.locator("#cheers .ch-fly").count()).toBe(0);
    await expect(page.locator("#cheers-pin .ch-splat")).toHaveCount(1);
    const moving = await page.evaluate(() =>
      document
        .getAnimations()
        .filter((a) => ((a.effect as KeyframeEffect | null)?.target as Element | null)?.closest?.("#cheers, #cheers-pin, #me-cheer"))
        .flatMap((a) => (a.effect as KeyframeEffect).getKeyframes())
        .filter((k) => ["transform", "translate", "scale", "rotate"].some((p) => (k as Record<string, unknown>)[p] !== undefined)).length,
    );
    expect(moving, "reduced motion: opacity only").toBe(0);
    await ctx.close();
  }
});

test("phone: a mash of tomatoes streams at the host's pace, and after this period's last both buttons dim, across a reload (v0.25)", async ({ browser }) => {
  // A replay sends nothing, but the phone's own pacing and cap run the same.
  const url = `/#/fixture/caught?as=innocent&t=${phaseAt("caught", "matchEnd") + 4500}&paused=1&ui=0`;
  const { ctx, page } = await phone(browser, url);
  await page.waitForFunction(() => !!window.__fixture);
  await page.waitForTimeout(800);
  // Count every throw that leaves this phone.
  await page.evaluate(() => {
    const w = window as unknown as { __thrown: number };
    w.__thrown = 0;
    new MutationObserver((list) => list.forEach((m) => m.addedNodes.forEach((n) => (n as Element).classList?.contains("ch-fly") && w.__thrown++))).observe(document.body, { childList: true, subtree: true });
  });
  const thrown = () => page.evaluate(() => (window as unknown as { __thrown: number }).__thrown);
  const tap = (id: string) => page.evaluate((sel) => document.querySelector<HTMLButtonElement>(sel)?.click(), id);
  // Twelve taps ~100ms apart: the ones that come too soon wait for the gap
  // instead of vanishing (it used to throw 4 of these).
  for (let i = 0; i < 12; i++) {
    await tap("#me-tomato");
    await page.waitForTimeout(100);
  }
  await page.waitForTimeout(1200);
  const mash = await thrown();
  expect(mash, "a mash keeps throwing at about 3 a second").toBeGreaterThanOrEqual(5);
  expect(mash).toBeLessThanOrEqual(8);
  // On to this period's last (30, tomatoes and applause together).
  for (let i = 0; i < 120 && !(await page.locator("#me-tomato").isDisabled()); i++) {
    await tap(i % 3 ? "#me-tomato" : "#me-clap");
    await page.waitForTimeout(120);
  }
  await expect(page.locator("#me-tomato")).toBeDisabled();
  await expect(page.locator("#me-clap"), "the cap covers applause too, and says so").toBeDisabled();
  await expect(page.locator(".toast")).toContainText("All thrown");
  await page.waitForTimeout(1000); // the last queued throws leave
  expect(await thrown(), "exactly this period's 30 flew").toBe(30);
  await page.locator("#me-clap").click({ force: true });
  await page.waitForTimeout(500);
  expect(await thrown(), "a spent button throws nothing").toBe(30);
  // A reload remembers: the host still counts this phone's 30.
  await page.reload();
  await page.waitForFunction(() => !!window.__fixture);
  await page.waitForTimeout(800);
  await expect(page.locator("#me-tomato")).toBeDisabled();
  await expect(page.locator("#me-clap")).toBeDisabled();
  await ctx.close();
});

// ---- v0.26 Grading on a curve ----

test("the class sets the difficulty: the next question is stamped harder or easier, and the reveal says why (v0.26)", async ({ browser }) => {
  type CurveTape = {
    t0: number;
    frames: {
      state: {
        phase: string;
        phaseStartedAt: number;
        match: null | {
          questionIdx: number;
          question: null | { tier: string; shift?: "up" | "down" };
          reveal: null | { next?: string; callout: unknown; startedAt: number };
        };
      };
    }[];
  };
  const t = JSON.parse(readFileSync("client/public/fixtures/topscore.json", "utf8")) as CurveTape;
  const stamped = t.frames.find((f) => f.state.phase === "question" && f.state.match?.question?.shift)!;
  expect(stamped, "the top-score tape moves the difficulty at least once").toBeTruthy();
  const shift = stamped.state.match!.question!.shift!;
  const qi = stamped.state.match!.questionIdx;
  const { ctx, page } = await phone(browser, `/#/fixture/topscore?as=innocent&t=${Math.round(stamped.state.phaseStartedAt - t.t0) + 1500}&paused=1&ui=0`);
  await page.waitForFunction(() => !!window.__fixture);
  await expect(page.locator(".qz-shift")).toHaveText(shift === "up" ? "▲ HARDER" : "▼ EASIER");
  await expect(page.locator(".qz-shift")).toHaveAttribute("aria-label", shift === "up" ? /everyone got the last one/ : /nobody got the last one/);
  // The question before it: its reveal carried the next tier, and (with no
  // evidence card in the slot) the class note says what happens next.
  const before = t.frames.find((f) => f.state.phase === "reveal" && f.state.match?.questionIdx === qi - 1 && f.state.match.reveal)!;
  const r = before.state.match!.reveal!;
  expect(r.next).toBe(stamped.state.match!.question!.tier);
  if (!r.callout) {
    await page.goto("about:blank");
    await page.goto(`/#/fixture/topscore?as=innocent&t=${Math.round(r.startedAt - t.t0) + 9000}&paused=1&ui=0`);
    await page.waitForFunction(() => !!window.__fixture);
    await expect(page.locator(".ev-curve")).toHaveText(shift === "up" ? "📈 Next one's harder." : "📉 Next one's easier.");
  }
  // A question the class didn't move carries no stamp.
  const plain = t.frames.find((f) => f.state.phase === "question" && f.state.match?.question && !f.state.match.question.shift)!;
  await page.goto("about:blank");
  await page.goto(`/#/fixture/topscore?as=innocent&t=${Math.round(plain.state.phaseStartedAt - t.t0) + 1500}&paused=1&ui=0`);
  await page.waitForFunction(() => !!window.__fixture);
  await expect(page.locator(".qz-card")).toBeVisible();
  await expect(page.locator(".qz-shift")).toHaveCount(0);
  await ctx.close();
});

test("fresh questions: the teacher's phone says how many it remembers, and Forget clears them (v0.26)", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: SE, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await ctx.addInitScript(() => {
    if (!sessionStorage.getItem("seeded")) {
      localStorage.setItem("hdykt-seen", JSON.stringify(["a1", "b2", "c3"]));
      sessionStorage.setItem("seeded", "1");
    }
  });
  const page = await ctx.newPage();
  await page.goto("/");
  await page.fill("#playerName", "Hana");
  await page.click("#hm-next");
  await page.click('[data-action="create"]');
  await page.waitForSelector(".screen-lobby");
  await page.click("#lb-adv summary");
  await expect(page.locator("#lb-fresh")).toContainText("remembers the 3 questions");
  const forget = page.locator("#lb-forget");
  expect((await forget.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await forget.click();
  await expect(page.locator("#lb-fresh")).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem("hdykt-seen"))).toBeNull();
  // The rules card explains the curve.
  await expect(page.locator(".how-card").first()).toContainText("starts medium");
  await ctx.close();
});

// ---- v0.27: nobody misses the bell ----

/** Host "Hana" (with any ?query) and these players in homeroom, not started. */
async function homeroom(browser: Browser, names: string[], query = "") {
  const host = await phone(browser, `/${query}`);
  await host.page.fill("#playerName", "Hana");
  await host.page.click("#hm-next");
  await host.page.click('[data-action="create"]');
  const code = (await host.page.locator(".roomcode").innerText({ timeout: 15000 })).replace(/\s/g, "");
  const players: Awaited<ReturnType<typeof phone>>[] = [];
  for (const name of names) {
    const p = await phone(browser, `/#/join/${code}`);
    await p.page.fill("#playerName", name);
    await p.page.click("#hm-next");
    await p.page.waitForSelector(".screen-lobby");
    players.push(p);
  }
  return { host, players, close: async () => Promise.all([host, ...players].map((p) => p.ctx.close())) };
}
const words = (s: string) => s.replace(/\s+/g, " ").trim();

test("the bell closes How to play on every phone, and holds a first period's note longer (v0.27)", async ({ browser }) => {
  const { host, players, close } = await homeroom(browser, ["Bea"]);
  const bea = players[0].page;
  await host.page.click("#lb-addbot");
  // A first-timer watches How to play in homeroom…
  await bea.click("#lb-howto");
  await expect(bea.locator("#tut")).toBeVisible();
  // …the teacher rings the bell: the video gets out of the way of her note.
  await host.page.click("#lb-start");
  await host.page.waitForSelector(".screen-role", { timeout: 20000 });
  await expect(bea.locator("#tut")).toHaveCount(0, { timeout: 1500 });
  await expect(bea.locator(".toast")).toContainText("The bell rang", { timeout: 1500 });
  await expect(bea.locator(".screen-role, .screen-question").first()).toBeVisible();
  // Period 1's bell holds 5.2 s on phones (3.2 s from period 2 on).
  await bea.waitForSelector(".screen-question", { timeout: 15000 });
  const beats = await beatsOf(bea);
  const bell = beats.find((b) => b.key.startsWith("role-1-0|"))!.server;
  const q1 = beats.find((b) => b.key.startsWith("question-1-0|"))!.server;
  expect(q1 - bell).toBeGreaterThan(4700);
  expect(q1 - bell).toBeLessThan(5800);
  // She read it as it landed: no dot on ⭐, no "you missed the bell".
  await expect(bea.locator(".sess-tab")).toBeVisible();
  await bea.waitForTimeout(600);
  expect(await bea.locator(".sess-tab.note-due").count()).toBe(0);
  expect(await bea.locator(".toast", { hasText: "missed the bell" }).count()).toBe(0);
  await close();
});

test("a phone that missed the bell can still read its note: hold 📝 in the ⭐ sheet (v0.27)", async ({ browser }) => {
  // Bea is the cheater (local test hook).
  const { host, players, close } = await homeroom(browser, ["Bea", "Cy"], "?debugCheater=Bea");
  const [bea, cy] = players.map((p) => p.page);
  const away = (hidden: boolean) =>
    bea.evaluate((h) => {
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => (h ? "hidden" : "visible") });
      document.dispatchEvent(new Event("visibilitychange"));
    }, hidden);
  // Bea is in another app as the bell rings (her page is hidden)…
  await away(true);
  await host.page.click("#lb-start");
  await bea.waitForSelector(".screen-question", { timeout: 30000 });
  // …and still there at question one: the dot waits for her, the toast
  // doesn't play to an empty screen…
  await expect(bea.locator(".sess-tab.note-due")).toBeVisible({ timeout: 5000 });
  expect(await bea.locator(".toast", { hasText: "missed the bell" }).count()).toBe(0);
  // …until she's back.
  await away(false);
  await expect(bea.locator(".toast")).toContainText("missed the bell");
  // A reload during Q1 doesn't count as having seen it.
  await bea.reload();
  await bea.waitForSelector(".screen-question", { timeout: 20000 });
  await expect(bea.locator(".sess-tab.note-due")).toBeVisible({ timeout: 5000 });
  await expect(bea.locator(".toast")).toContainText("missed the bell");
  // ⭐ opens the sheet; its first row is the note, thumb-sized.
  await bea.click(".sess-tab");
  const row = bea.locator("#sheet-note");
  await expect(row).toBeVisible();
  expect((await row.boundingBox())!.height).toBeGreaterThanOrEqual(48);
  // Holding it shows her note; letting go hides it.
  const peekEl = bea.locator("#note-peek");
  await row.dispatchEvent("pointerdown");
  await expect(peekEl).toBeVisible();
  expect(words(await peekEl.locator(".np-line").innerText())).toBe("It's you. Find the dot. 🤫");
  await row.dispatchEvent("pointerup");
  await expect(peekEl).toBeHidden();
  expect(await peekEl.textContent()).toBe(""); // nothing secret left behind
  expect(await bea.locator(".sess-tab.note-due").count(), "a glance isn't a read").toBe(1);
  // A real hold (800 ms) counts as read: the dot goes, the sheet stays.
  await row.dispatchEvent("pointerdown");
  await bea.waitForTimeout(800);
  await row.dispatchEvent("pointerup");
  await expect(bea.locator(".sess-tab.note-due")).toHaveCount(0);
  await expect(row).toBeVisible();
  // Cy saw the bell: no dot. The same row, with his own note behind it.
  expect(await cy.locator(".sess-tab.note-due").count()).toBe(0);
  await cy.click(".sess-tab");
  const cyRow = cy.locator("#sheet-note");
  await expect(cyRow).toBeVisible();
  expect(await cyRow.evaluate((el) => el.outerHTML)).toBe(await row.evaluate((el) => el.outerHTML));
  await cyRow.dispatchEvent("pointerdown");
  await expect(cy.locator("#note-peek")).toBeVisible();
  expect(words(await cy.locator("#note-peek .np-line").innerText())).toBe("Not you. Watch closely. 🤫");
  await cyRow.dispatchEvent("pointerup");
  // The teacher rang it, so the teacher saw it.
  expect(await host.page.locator(".sess-tab.note-due").count()).toBe(0);
  await close();
});

test("back after the bell with How to play still open: the video closes, and the toast that stays is the missed note (v0.27)", async ({ browser }) => {
  const { host, players, close } = await homeroom(browser, ["Bea"]);
  const bea = players[0];
  for (let i = 0; i < 2; i++) {
    await host.page.click("#lb-addbot");
    await host.page.waitForTimeout(120);
  }
  // A first-timer watches How to play, and her phone drops off the Wi-Fi…
  await bea.page.click("#lb-howto");
  await expect(bea.page.locator("#tut")).toBeVisible();
  await bea.ctx.setOffline(true);
  await bea.page.evaluate(() => (window.__hdykt as unknown as { dropSocket(): void }).dropSocket());
  // …through the bell, and is back during question one.
  await host.page.click("#lb-start");
  await host.page.waitForSelector(".screen-question", { timeout: 30000 });
  await bea.ctx.setOffline(false);
  await bea.page.waitForSelector(".screen-question", { timeout: 30000 });
  await expect(bea.page.locator("#tut")).toHaveCount(0);
  // "The bell rang" is old news: the toast she can act on is the one left up.
  await expect(bea.page.locator(".toast")).toContainText("missed the bell");
  await expect(bea.page.locator(".sess-tab.note-due")).toBeVisible();
  await close();
});

interface CalloutTape {
  t0: number;
  frames: { state: { phase: string; phaseStartedAt: number; match: { questionIdx: number; reveal: { callout: { q: number; kind: string; detail: Record<string, number> } | null } | null; caseFile: { q: number; kind: string; detail: Record<string, number> }[] } | null } }[];
}
const EXHIBIT_KINDS = ["lone_correct", "against_crowd", "lightning", "streak", "hard_sweep"];
const groupOf = (e: { kind: string; detail: Record<string, number> }) =>
  EXHIBIT_KINDS.includes(e.kind) ? "exhibit" : e.kind === "near_line" ? "near_line" : e.kind === "cleared" && !e.detail.absent && !e.detail.vote ? "cleared" : "";
/** Each reveal of a recorded match with its callout's group, and whether
 *  it is the first of its group in the case file (the one that teaches). */
function calloutReveals(name: string) {
  const tape = JSON.parse(readFileSync(`client/public/fixtures/${name}.json`, "utf8")) as CalloutTape;
  const out: { t: number; q: number; group: string; first: boolean }[] = [];
  for (const f of tape.frames) {
    const m = f.state.match;
    const c = m?.reveal?.callout;
    if (f.state.phase !== "reveal" || !c || out.some((r) => r.q === c.q)) continue;
    const group = groupOf(c);
    const first = m!.caseFile.find((e) => groupOf(e) === group);
    out.push({ t: Math.round(f.state.phaseStartedAt - tape.t0), q: c.q, group, first: !!group && first?.q === c.q && first.kind === c.kind });
  }
  return out;
}

test("the first period teaches Act II's clues once each: exhibits, the 🎓 line, CLEARED (v0.27)", async ({ browser }) => {
  // The caught tape's first exhibit teaches; its next one is back to the usual footer.
  const exhibits = calloutReveals("caught").filter((r) => r.group === "exhibit");
  expect(exhibits.length).toBeGreaterThanOrEqual(2);
  const { ctx, page } = await phone(browser, `/#/fixture/caught?as=innocent&t=${exhibits[0].t + 9000}&paused=1&ui=0`);
  await page.waitForFunction(() => !!window.__fixture);
  const note = page.locator("#ev-foot.ev-teach2");
  await expect(note).toContainText("Exhibits pin an icon to a name");
  // Two lines in its own box, nothing cut off or sideways; ACCUSE still on an SE's screen.
  const fit = await note.evaluate((el) => ({ clipped: el.scrollHeight > el.clientHeight + 1, h: el.clientHeight }));
  expect(fit.clipped, "the note fits its two lines").toBe(false);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)).toBe(false);
  const dock = (await page.locator("#rv-accuse").boundingBox())!;
  expect(dock.y + dock.height, "ACCUSE on screen").toBeLessThanOrEqual(SE.height);
  // Screen readers hear it with the exhibit.
  await expect(page.locator('#app p.sr-only[role="status"]')).toContainText("Teacher's note: Exhibits pin");
  await page.evaluate((t) => window.__fixture!.seek(t), exhibits[1].t + 9000);
  await page.waitForTimeout(600);
  expect(await page.locator(".ev-teach2").count(), "each note once").toBe(0);
  await expect(page.locator("#ev-foot")).toHaveText("Evidence, not proof.");
  // Before the evidence beat the box is already there (reserved), and invisible.
  await page.evaluate((t) => window.__fixture!.seek(t), exhibits[0].t + 600);
  await page.waitForTimeout(500);
  expect(await note.evaluate((el) => getComputedStyle(el).opacity)).toBe("0");
  expect(await note.evaluate((el) => el.clientHeight), "the same box from frame 0").toBe(fit.h);
  await ctx.close();

  // The first exhibit, near-the-line and earned CLEARED, wherever a tape has
  // one: the copy, in two lines, on an SE and at 320px.
  const COPY: Record<string, RegExp> = {
    exhibit: /Exhibits pin an icon to a name in the grade book\. One is luck; a pile is a pattern\./,
    near_line: /If it's them and they reach 🎓\d+, the cheater wins\. Accuse now, or trust them\./,
    cleared: /Over the line with no siren: can't be the cheater\. Cross them off\./,
  };
  for (const group of ["exhibit", "near_line", "cleared"]) {
    const found = ["caught", "graduated", "topscore", "detention", "struckout", "fullclass"]
      .map((name) => ({ name, r: calloutReveals(name).find((x) => x.group === group && x.first) }))
      .find((x) => x.r);
    if (!found) throw new Error(`no tape has a first ${group} callout any more: this note goes unchecked`);
    for (const viewport of [SE, { width: 320, height: 568 }]) {
      const p = await phone(browser, `/#/fixture/${found.name}?as=innocent&t=${found.r!.t + 9000}&paused=1&ui=0`, viewport);
      await p.page.waitForFunction(() => !!window.__fixture);
      const n = p.page.locator("#ev-foot.ev-teach2");
      await expect(n, `${group} in ${found.name}`).toContainText(COPY[group]);
      expect(await n.evaluate((el) => el.scrollHeight > el.clientHeight + 1), `${group} fits at ${viewport.width}px`).toBe(false);
      expect(await p.page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)).toBe(false);
      await p.ctx.close();
    }
  }
});

test("the ⭐ sheet on an SE with a full class: the 📝 row first, every name and Close within reach (v0.27)", async ({ browser }) => {
  const { ctx, page } = await phone(browser, `/#/fixture/fullclass?as=innocent&t=${phaseAt("fullclass", "question", 2) + 4000}&paused=1&ui=0`);
  await page.waitForFunction(() => !!window.__fixture);
  await page.click(".sess-tab");
  const sheet = page.locator(".overlay .sheet");
  await expect(sheet.locator(".player-li")).toHaveCount(10);
  expect(await sheet.evaluate((el) => el.querySelector("h2 + *")?.id), "the note comes first").toBe("sheet-note");
  // Ten names and the row are taller than an SE: the sheet stays on screen and scrolls.
  const box = (await sheet.boundingBox())!;
  expect(box.y + box.height).toBeLessThanOrEqual(SE.height + 1);
  await sheet.locator(".player-li").last().scrollIntoViewIfNeeded();
  await expect(sheet.locator(".player-li").last()).toBeInViewport();
  await sheet.locator('[data-action="toggleBoard"]').click();
  await expect(sheet).toHaveCount(0);
  await ctx.close();
});
