// Baseline capture of the CURRENT build (before the reveal redesign).
//
// Drives a full match at 380px with the CPU throttled (default 4x) in two
// browser contexts (host + one human player, plus two host-side bots),
// screenshots every screen, records host video, and instruments each page:
// phase timeline, rAF frame timing per phase, full #app re-renders, CSS
// animation restarts, transitions, long tasks, layout checks, the role-screen
// tell, and host<->player phase sync.
//
// Usage (server must already be serving the built client):
//   node tools/capture-current.mjs                 full run (~3 min)
//   node tools/capture-current.mjs --report-only   rebuild REPORT.md from report.json
// Env: CAPTURE_URL (default http://localhost:3000), CAPTURE_THROTTLE (default 4)
//
// Output: capture/current/{report.json, REPORT.md, NN-ctx-phase.png, video/host.(webm|avi)}
// (host.webm via Playwright recordVideo when its ffmpeg is installed; otherwise
// a CDP screencast muxed to MJPEG AVI by this script.)
// After the match, a parity probe deals extra rooms until a human is the
// cheater and pixel-diffs the cheater's vs an innocent's role/question screens.
// If capture/current/observations.md exists, it is appended to REPORT.md.
import { chromium } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "capture", "current");
const VIDEO_DIR = path.join(OUT, "video");
const BASE = process.env.CAPTURE_URL ?? "http://localhost:3000";
const THROTTLE = Number(process.env.CAPTURE_THROTTLE ?? 4);
const VIEWPORT = { width: 380, height: 800 };
const HUMANS = ["Host", "Player2"];
const RUN_LIMIT_MS = 20 * 60 * 1000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = (a, b) => a + Math.random() * (b - a);
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1).padStart(6)}s]`, ...a);

// ---------------------------------------------------------------------------
// In-page instrumentation (serialized into every page via addInitScript).
// ---------------------------------------------------------------------------
function instrument() {
  if (window.__cap) return;
  const now = () => performance.timeOrigin + performance.now();
  const r1 = (n) => Math.round(n * 10) / 10;
  const cap = (window.__cap = {
    timeOrigin: performance.timeOrigin,
    phases: [], // phase instances: {inst, phase, key, q, occ, domAt, paintAt}
    marks: [], // {name, key, inst, t}
    frames: [], // flat triples [absT, dt, inst]
    renders: [], // full #app child replacements {t, inst, phase}
    anims: [], // {t, type, name, cls, inst, phase}
    trans: [], // {t, type, prop, cls, inst, phase}
    longtasks: [], // {t, dur}
    layout: [], // per instance layout checks
    roleSamples: [], // .role-extra samples while on the role screen
    checkWindows: [], // [start, end] of in-page layout checks (excluded from clean frame stats)
    errors: [],
  });
  let cur = { inst: 0, phase: "boot", key: "boot", q: null, occ: 1, domAt: now(), paintAt: null };
  cap.phases.push(cur);
  const occ = {};
  const marked = new Set();
  let lastQ = null;

  const desc = (el) => {
    if (!el || !el.tagName) return "?";
    let s = el.tagName.toLowerCase();
    if (el.id) s += "#" + el.id;
    const c = el.getAttribute("class");
    if (c && c.trim()) s += "." + c.trim().split(/\s+/).join(".");
    const a = el.getAttribute("data-action");
    if (a) s += `[data-action=${a}]`;
    return s;
  };
  const clsOf = (el) => (el && el.getAttribute ? el.getAttribute("class") || el.tagName.toLowerCase() : String(el));

  function classify(app) {
    const has = (s) => app.querySelector(s);
    let phase = "unknown";
    if (!app.firstElementChild) phase = "boot";
    else if (has(".podium")) phase = "sessionEnd";
    else if (has(".end-banner")) phase = "matchEnd";
    else if (has(".result-banner")) phase = "voteResult";
    else if (has(".vote-grid")) phase = "vote";
    else if (has(".reveal-row")) phase = "reveal";
    else if (has(".timer-wrap")) phase = "question";
    else if (has(".role-screen")) phase = "role";
    else if (has(".roomcode")) phase = "lobby";
    else if (has("#scr-home")) phase = "home";
    const qm = app.querySelector(".qnum")?.textContent.match(/Q(\d+)/);
    let q = qm ? Number(qm[1]) : null;
    if (q !== null) lastQ = q;
    if ((phase === "vote" || phase === "voteResult") && q === null) q = lastQ;
    return { phase, q };
  }

  function captureRole() {
    const el = document.querySelector(".role-extra");
    const scr = document.querySelector(".role-screen");
    if (!el) return;
    const r = el.getBoundingClientRect();
    const rs = scr ? scr.getBoundingClientRect() : null;
    const text = el.textContent || "";
    cap.roleSamples.push({
      t: now(),
      text,
      len: text.length,
      trimmedLen: text.trim().length,
      empty: text.trim().length === 0,
      box: { x: r1(r.x), y: r1(r.y), w: r1(r.width), h: r1(r.height) },
      screenBox: rs ? { x: r1(rs.x), y: r1(rs.y), w: r1(rs.width), h: r1(rs.height) } : null,
      screenText: scr ? scr.innerText.replace(/\s+/g, " ").trim() : null,
    });
  }

  function layoutCheck(inst) {
    const app = document.getElementById("app");
    if (!app) return;
    const ph = cap.phases[inst];
    const de = document.documentElement;
    const vw = de.clientWidth;
    const vh = window.innerHeight;
    const out = {
      inst,
      phase: ph.phase,
      key: ph.key,
      t: now(),
      vw,
      vh,
      scrollWidth: de.scrollWidth,
      scrollHeight: de.scrollHeight,
      overflowX: de.scrollWidth > vw,
      wide: [],
      small: [],
      ellipsis: [],
      fold: {},
    };
    const all = app.querySelectorAll("*");
    for (const el of all) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && (r.right > vw + 0.5 || r.left < -0.5) && out.wide.length < 15)
        out.wide.push({ sel: desc(el), left: r1(r.left), right: r1(r.right) });
      const cs = getComputedStyle(el);
      if (cs.textOverflow === "ellipsis" && el.scrollWidth > el.clientWidth + 0.5)
        out.ellipsis.push({ sel: desc(el), text: (el.textContent || "").trim().slice(0, 60), scrollW: el.scrollWidth, clientW: el.clientWidth });
    }
    for (const el of app.querySelectorAll("button, [data-action], input, select, summary, a[href]")) {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      if (r.width < 44 || r.height < 44)
        out.small.push({ sel: desc(el), w: r1(r.width), h: r1(r.height), text: (el.textContent || "").trim().slice(0, 30) });
    }
    for (const s of ["[data-action=accuse]", "[data-action=advance]", ".board", ".reveal-row", "[data-action=start]", ".vote-grid", ".vote-cell", "[data-action=endSession]", ".opt"]) {
      const els = app.querySelectorAll(s);
      if (!els.length) continue;
      const last = els[els.length - 1].getBoundingClientRect();
      const first = els[0].getBoundingClientRect();
      out.fold[s] = {
        count: els.length,
        top: r1(first.top + window.scrollY),
        bottom: r1(last.bottom + window.scrollY),
        fullyAboveFold: last.bottom + window.scrollY <= vh,
        scrollY: window.scrollY,
      };
    }
    cap.layout.push(out);
  }

  function check(src) {
    const app = document.getElementById("app");
    if (!app) return;
    const { phase, q } = classify(app);
    const key = q !== null && ["question", "reveal", "vote", "voteResult"].includes(phase) ? `${phase}:Q${q}` : phase;
    if (key !== cur.key) {
      occ[key] = (occ[key] || 0) + 1;
      cur = { inst: cap.phases.length, phase, key, q, occ: occ[key], domAt: now(), paintAt: null, src };
      cap.phases.push(cur);
      const inst = cur.inst;
      setTimeout(() => {
        if (cur.inst !== inst || phase === "boot") return; // screen already gone
        const s = now();
        try { layoutCheck(inst); } catch (e) { cap.errors.push("layout:" + e); }
        cap.checkWindows.push([s, now()]);
      }, 900);
    }
    if (phase === "role") {
      const txt = app.querySelector(".role-extra")?.textContent ?? null;
      const lastS = cap.roleSamples[cap.roleSamples.length - 1];
      if (txt !== null && (!lastS || lastS.inst !== cur.inst || lastS.text !== txt)) {
        captureRole();
        cap.roleSamples[cap.roleSamples.length - 1].inst = cur.inst;
      }
    }
    if (phase === "question" && app.querySelector(".opt[disabled]")) {
      const mk = `answered@${cur.inst}`;
      if (!marked.has(mk)) { marked.add(mk); cap.marks.push({ name: "answered", key: cur.key, inst: cur.inst, t: now() }); }
    }
    if (app.querySelector(".btn.accuse.confirm")) {
      const mk = `accuseConfirm@${cur.inst}`;
      if (!marked.has(mk)) { marked.add(mk); cap.marks.push({ name: "accuseConfirm", key: cur.key, inst: cur.inst, t: now() }); }
    }
  }
  window.__capLayout = () => {
    const s = now();
    try { layoutCheck(cur.inst); } catch (e) { cap.errors.push("layout:" + e); }
    cap.checkWindows.push([s, now()]);
  };

  function attach() {
    const app = document.getElementById("app");
    if (!app) return false;
    if (app.__capAttached) return true;
    app.__capAttached = true;
    new MutationObserver((recs) => {
      // One record per `root.innerHTML = ...` (childList on #app only).
      let full = 0;
      for (const r of recs) if (r.target === app && r.type === "childList" && r.addedNodes.length && r.removedNodes.length) full++;
      check("mo"); // classify first: a phase-changing render belongs to the new phase
      if (full) cap.renders.push({ t: now(), inst: cur.inst, phase: cur.phase, records: full });
    }).observe(app, { childList: true });
    check("attach");
    return true;
  }
  if (!attach()) {
    const mo = new MutationObserver(() => { if (attach()) mo.disconnect(); });
    mo.observe(document, { childList: true, subtree: true });
  }

  // rAF sampler: frame intervals bucketed by current phase instance.
  let lastTs = null;
  function loop(ts) {
    try { check("raf"); } catch (e) { cap.errors.push("check:" + e); }
    if (cur.paintAt === null) cur.paintAt = now();
    if (lastTs !== null) cap.frames.push(r1(performance.timeOrigin + ts), r1(ts - lastTs), cur.inst);
    lastTs = ts;
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  for (const type of ["animationstart", "animationend", "animationcancel"])
    document.addEventListener(type, (e) => cap.anims.push({ t: now(), type, name: e.animationName, cls: clsOf(e.target), inst: cur.inst, phase: cur.phase }), true);
  for (const type of ["transitionrun", "transitionstart", "transitionend", "transitioncancel"])
    document.addEventListener(type, (e) => cap.trans.push({ t: now(), type, prop: e.propertyName, cls: clsOf(e.target), inst: cur.inst, phase: cur.phase }), true);
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) cap.longtasks.push({ t: r1(performance.timeOrigin + e.startTime), dur: r1(e.duration) });
    }).observe({ type: "longtask", buffered: true });
  } catch (e) {
    cap.errors.push("longtask:" + e);
  }
  window.addEventListener("error", (e) => cap.errors.push("window:" + e.message));
}

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------
const shots = [];
const shotWindows = []; // [startMs, endMs] across both contexts (frames excluded from "clean" stats)
const actions = [];
let shotN = 0;

async function shot(ctx, page, name, opts = {}) {
  shotN++;
  const file = `${String(shotN).padStart(2, "0")}-${ctx}-${name}.png`;
  const s = Date.now();
  const { noLayout, ...shotOpts } = opts;
  try {
    await page.screenshot({ path: path.join(OUT, file), ...shotOpts });
    shots.push({ file, ctx, name, t: s, fullPage: !!opts.fullPage });
    log(`[${ctx}] screenshot ${file}`);
    // Layout check of exactly what was photographed (catches elements added
    // after the automatic 900 ms check, e.g. bots joining the lobby).
    if (!opts.fullPage && !noLayout) await page.evaluate(() => window.__capLayout && window.__capLayout());
  } catch (e) {
    log(`[${ctx}] screenshot ${file} FAILED: ${e.message}`);
  }
  shotWindows.push([s, Date.now()]);
}

async function act(ctx, desc, fn) {
  actions.push({ t: Date.now(), ctx, action: desc });
  log(`[${ctx}] ${desc}`);
  await fn();
}

const probe = (page) =>
  page.evaluate(() => {
    const app = document.getElementById("app");
    const c = window.__cap;
    const cur = c ? c.phases[c.phases.length - 1] : null;
    const q = (s) => (app ? app.querySelector(s) : null);
    const adv = q("[data-action=advance]");
    const acc = q("[data-action=accuse]");
    return {
      phase: cur?.phase,
      key: cur?.key,
      inst: cur?.inst,
      occ: cur?.occ,
      q: cur?.q,
      answered: !!q(".opt[disabled]"),
      optCount: app ? app.querySelectorAll(".opt").length : 0,
      optsEnabled: app ? app.querySelectorAll(".opt:not([disabled])").length : 0,
      cheatIdx: app ? [...app.querySelectorAll(".opt")].findIndex((o) => o.classList.contains("cheat-mark")) : -1,
      advance: adv ? !adv.disabled : null,
      accuse: acc ? !acc.disabled : null,
      accuseConfirm: !!q(".btn.accuse.confirm"),
      voteEnabled: app ? app.querySelectorAll(".vote-cell:not([disabled])").length : 0,
      endSession: !!q("[data-action=endSession]"),
      board: app ? [...app.querySelectorAll(".bar-row")].map((r) => ({ name: r.querySelector(".nm")?.textContent.trim() ?? "", score: Number(r.querySelector(".sc")?.textContent ?? 0) })) : [],
      voteCells: app ? [...app.querySelectorAll(".vote-cell")].map((b) => b.textContent.replace(/\s+/g, " ").trim()) : [],
      offlineChip: !!q(".chip.offline"),
      endBanner: q(".end-banner")?.textContent.trim() ?? null,
      cheaterReveal: q(".cheater-reveal")?.textContent.replace(/\s+/g, " ").trim() ?? null,
      resultBanner: q(".result-banner")?.textContent.trim() ?? null,
      thrDrop: q(".thr-drop")?.textContent.trim() ?? null,
    };
  });

const shared = {
  done: false,
  matchEnded: false,
  accused: false,
  lastBoard: [], // grade book scraped by the host at the latest reveal
  voteTargets: {}, // "key#occ" -> target name (both humans vote together)
  voteResults: {}, // "key#occ" -> result banner text
  offlineChip: false,
  endBanner: null,
  cheaterReveal: null,
};

function chooseVoteTarget(cells) {
  // "Vote for a bot": both humans pile onto the bot with the LOWEST score in
  // the last grade book (least likely to be the cheater, so the match usually
  // continues and we get more reveals to measure).
  const isHuman = (txt) => HUMANS.some((h) => txt.includes(h));
  const botCells = cells.filter((c) => !isHuman(c));
  if (!botCells.length) return cells[0];
  const scoreOf = (cell) => {
    const row = shared.lastBoard.find((r) => cell.includes(r.name.replace(/^\S+\s+/, "").replace(" 🪑", "")));
    return row ? row.score : 0;
  };
  return [...botCells].sort((a, b) => scoreOf(a) - scoreOf(b))[0];
}

async function playLoop(ctx, page, isHost) {
  const firstShot = new Set();
  const answerAt = {};
  const answered = new Set();
  const voted = new Set();
  const advanceReadyAt = {};
  let lastKey = null;
  let revealCount = 0;
  const start = Date.now();
  const want = (k) => (firstShot.has(k) ? false : (firstShot.add(k), true));

  while (Date.now() - start < RUN_LIMIT_MS) {
    if (!isHost && shared.done) break;
    let s;
    try {
      s = await probe(page);
    } catch (e) {
      log(`[${ctx}] probe error ${e.message}`);
      await sleep(300);
      continue;
    }
    if (s.key !== lastKey) {
      log(`[${ctx}] phase -> ${s.key} (#${s.occ})`);
      lastKey = s.key;
      if (s.phase === "reveal") revealCount++;
    }
    const instKey = `${s.key}#${s.occ}`;
    if (isHost) {
      if (s.offlineChip) shared.offlineChip = true;
      if (s.endBanner) shared.endBanner = s.endBanner;
      if (s.cheaterReveal) shared.cheaterReveal = s.cheaterReveal;
      if (s.resultBanner) (shared.voteResults[instKey] ??= `${s.resultBanner}${s.thrDrop ? ` (${s.thrDrop})` : ""}`);
    }
    try {
      switch (s.phase) {
        case "role":
          if (want("role")) await shot(ctx, page, "role");
          break;
        case "question": {
          if (want("question")) await shot(ctx, page, "question");
          // Retry if a tap was swallowed by a concurrent re-render (max 3 tries).
          if (!s.answered && answered.has(instKey) && Date.now() - answerAt[instKey + ":clicked"] > 2000 && (answerAt[instKey + ":tries"] ?? 0) < 3) {
            log(`[${ctx}] answer on ${instKey} did not register; retrying`);
            answered.delete(instKey);
          }
          if (!s.answered && s.optsEnabled > 0 && !answered.has(instKey)) {
            if (!answerAt[instKey]) answerAt[instKey] = Date.now() + rand(1200, 4500);
            if (Date.now() >= answerAt[instKey]) {
              const pick = s.cheatIdx >= 0 ? s.cheatIdx : Math.floor(Math.random() * s.optCount);
              answered.add(instKey);
              answerAt[instKey + ":clicked"] = Date.now();
              answerAt[instKey + ":tries"] = (answerAt[instKey + ":tries"] ?? 0) + 1;
              await act(ctx, `answer ${s.key} -> option ${pick}${s.cheatIdx >= 0 ? " (cheat-mark)" : ""}`, () =>
                page.locator(".opt").nth(pick).click({ timeout: 5000 }),
              );
              if (want("question-answered")) {
                await sleep(250);
                await shot(ctx, page, "question-answered");
              }
            }
          }
          break;
        }
        case "reveal": {
          if (isHost) shared.lastBoard = s.board;
          if (want("reveal")) {
            await sleep(400);
            await shot(ctx, page, "reveal");
            await shot(ctx, page, "reveal-full", { fullPage: true });
          }
          if (isHost && s.q === 2 && !shared.accused && s.accuse) {
            shared.accused = true;
            await sleep(1500);
            await act(ctx, `accuse (tap 1) on ${s.key}`, () => page.locator("[data-action=accuse]").click({ timeout: 5000 }));
            await sleep(300);
            // v0.23: pointing at nobody, ACCUSE asks whom first.
            if (await page.locator("#pt-sheet").count()) {
              await shot(ctx, page, "reveal-accuse-who");
              await act(ctx, `accuse: pick a suspect on ${s.key}`, () => page.locator("#pt-sheet .pt-row").first().click({ timeout: 5000 }));
              await sleep(600);
            }
            await shot(ctx, page, "reveal-accuse-confirm");
            await act(ctx, `accuse (tap 2, confirm) on ${s.key}`, () => page.locator("[data-action=accuse]").click({ timeout: 5000 }));
            break;
          }
          if (s.q === 9 && want("reveal-late")) await shot(ctx, page, "reveal-late");
          if (isHost && s.advance) {
            if (!advanceReadyAt[instKey]) advanceReadyAt[instKey] = Date.now() + 1000;
            else if (Date.now() >= advanceReadyAt[instKey] && !advanceReadyAt[instKey + ":clicked"]) {
              advanceReadyAt[instKey + ":clicked"] = true;
              await act(ctx, `advance from ${s.key}`, () => page.locator("[data-action=advance]").click({ timeout: 5000 }));
            }
          }
          break;
        }
        case "vote": {
          if (want("vote")) await shot(ctx, page, "vote");
          if (s.voteEnabled > 0 && !voted.has(instKey)) {
            voted.add(instKey);
            if (!shared.voteTargets[instKey]) shared.voteTargets[instKey] = chooseVoteTarget(s.voteCells);
            const target = shared.voteTargets[instKey];
            await sleep(rand(800, 2200));
            await act(ctx, `vote on ${instKey} -> "${target}"`, () =>
              page.locator(".vote-cell", { hasText: target.replace(/^\S+\s+/, "") }).first().click({ timeout: 5000 }),
            );
            if (want("vote-voted")) {
              await sleep(300);
              await shot(ctx, page, "vote-voted");
            }
          }
          break;
        }
        case "voteResult": {
          if (want("voteResult")) {
            await sleep(500);
            await shot(ctx, page, "voteResult");
          }
          if (isHost && !advanceReadyAt[instKey]) {
            advanceReadyAt[instKey] = true;
            await sleep(2000);
            await act(ctx, `advance from ${instKey}`, () => page.locator("[data-action=advance]").click({ timeout: 5000 }));
          }
          break;
        }
        case "matchEnd": {
          shared.matchEnded = true;
          if (want("matchEnd")) {
            await sleep(700);
            await shot(ctx, page, "matchEnd");
            await shot(ctx, page, "matchEnd-full", { fullPage: true });
          }
          if (isHost && !advanceReadyAt.matchEnd) {
            advanceReadyAt.matchEnd = true;
            await sleep(2500);
            if (s.endSession)
              await act(ctx, "endSession from matchEnd", () => page.locator("[data-action=endSession]").click({ timeout: 5000 }));
            else await act(ctx, "advance to lobby", () => page.locator("[data-action=advance]").click({ timeout: 5000 }));
          }
          break;
        }
        case "lobby":
          if (isHost && shared.matchEnded && s.endSession && !advanceReadyAt.lobbyEnd) {
            advanceReadyAt.lobbyEnd = true;
            await act(ctx, "endSession from lobby", () => page.locator("[data-action=endSession]").click({ timeout: 5000 }));
          }
          break;
        case "sessionEnd":
          if (want("sessionEnd")) {
            await sleep(600);
            await shot(ctx, page, "sessionEnd");
          }
          if (isHost) {
            await sleep(1500); // let the player context see it too
            shared.done = true;
            return { revealCount };
          }
          break;
      }
    } catch (e) {
      log(`[${ctx}] action error in ${s.key}: ${e.message.split("\n")[0]}`);
    }
    await sleep(120);
  }
  return { revealCount, timedOut: Date.now() - start >= RUN_LIMIT_MS };
}

const CONTEXT_OPTS = { viewport: VIEWPORT, deviceScaleFactor: 2, isMobile: true, hasTouch: true };

async function newPage(browser, name, video) {
  let context = await browser.newContext({ ...CONTEXT_OPTS, ...(video ? { recordVideo: { dir: VIDEO_DIR, size: VIEWPORT } } : {}) });
  let page;
  let videoMode = video ? "playwright" : null;
  try {
    await context.addInitScript(instrument);
    page = await context.newPage();
  } catch (e) {
    // Playwright's recorder needs its own ffmpeg build (ms-playwright/ffmpeg-*),
    // which is a separate download. Without it, fall back to a CDP screencast
    // muxed into an MJPEG AVI by this script (same frames recordVideo would use).
    if (!video || !/ffmpeg/i.test(e.message)) throw e;
    log(`[${name}] recordVideo unavailable (${e.message.split("\n")[0]}); using CDP screencast -> MJPEG AVI`);
    await context.close().catch(() => {});
    context = await browser.newContext(CONTEXT_OPTS);
    await context.addInitScript(instrument);
    page = await context.newPage();
    videoMode = "screencast";
  }
  const cdp = await context.newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: THROTTLE });
  let screencast = null;
  if (videoMode === "screencast") {
    screencast = [];
    cdp.on("Page.screencastFrame", ({ data, sessionId, metadata }) => {
      screencast.push({ t: metadata?.timestamp ? metadata.timestamp * 1000 : Date.now(), buf: Buffer.from(data, "base64") });
      cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
    });
    await cdp.send("Page.startScreencast", { format: "jpeg", quality: 55, maxWidth: VIEWPORT.width, maxHeight: VIEWPORT.height, everyNthFrame: 1 });
  }
  page.on("pageerror", (e) => log(`[${name}] pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") log(`[${name}] console.error: ${m.text()}`);
  });
  return { context, page, cdp, videoMode, screencast };
}

// Minimal MJPEG-in-AVI muxer (RIFF 'AVI ', one video stream, idx1 index).
// Frames are resampled to a constant `fps` by repeating the latest frame.
function jpegSize(buf) {
  for (let i = 2; i < buf.length - 9; ) {
    if (buf[i] !== 0xff) { i++; continue; }
    const m = buf[i + 1];
    const len = buf.readUInt16BE(i + 2);
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
    i += 2 + len;
  }
  return { w: VIEWPORT.width, h: VIEWPORT.height };
}

async function writeMjpegAvi(frames, file, fps = 10) {
  if (!frames.length) return null;
  frames.sort((a, b) => a.t - b.t);
  const { w, h } = jpegSize(frames[0].buf);
  const startT = frames[0].t;
  const endT = frames[frames.length - 1].t + 1000;
  const seq = [];
  let fi = 0;
  for (let t = startT; t <= endT; t += 1000 / fps) {
    while (fi + 1 < frames.length && frames[fi + 1].t <= t) fi++;
    seq.push(frames[fi].buf);
  }
  const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; };
  const fcc = (s) => Buffer.from(s, "ascii");
  const chunk = (id, body) => Buffer.concat([fcc(id), u32(body.length), body, body.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0)]);
  const list = (type, parts) => { const body = Buffer.concat([fcc(type), ...parts]); return Buffer.concat([fcc("LIST"), u32(body.length), body]); };
  const maxFrame = Math.max(...seq.map((b) => b.length));
  const avih = Buffer.alloc(56);
  avih.writeUInt32LE(Math.round(1e6 / fps), 0);
  avih.writeUInt32LE(maxFrame * fps, 4);
  avih.writeUInt32LE(0x10, 12); // AVIF_HASINDEX
  avih.writeUInt32LE(seq.length, 16);
  avih.writeUInt32LE(1, 24);
  avih.writeUInt32LE(maxFrame, 28);
  avih.writeUInt32LE(w, 32);
  avih.writeUInt32LE(h, 36);
  const strh = Buffer.alloc(56);
  fcc("vids").copy(strh, 0);
  fcc("MJPG").copy(strh, 4);
  strh.writeUInt32LE(1, 20); // scale
  strh.writeUInt32LE(fps, 24); // rate
  strh.writeUInt32LE(seq.length, 32); // length
  strh.writeUInt32LE(maxFrame, 36);
  strh.writeInt32LE(-1, 40); // quality
  strh.writeUInt16LE(w, 52);
  strh.writeUInt16LE(h, 54);
  const strf = Buffer.alloc(40);
  strf.writeUInt32LE(40, 0);
  strf.writeInt32LE(w, 4);
  strf.writeInt32LE(h, 8);
  strf.writeUInt16LE(1, 12);
  strf.writeUInt16LE(24, 14);
  fcc("MJPG").copy(strf, 16);
  strf.writeUInt32LE(w * h * 3, 20);
  const hdrl = list("hdrl", [chunk("avih", avih), list("strl", [chunk("strh", strh), chunk("strf", strf)])]);
  // movi + idx1
  const idx = Buffer.alloc(16 * seq.length);
  let off = 4; // offsets are relative to the 'movi' fourcc
  const moviParts = [];
  seq.forEach((b, i) => {
    const c = chunk("00dc", b);
    fcc("00dc").copy(idx, i * 16);
    idx.writeUInt32LE(0x10, i * 16 + 4); // AVIIF_KEYFRAME
    idx.writeUInt32LE(off, i * 16 + 8);
    idx.writeUInt32LE(b.length, i * 16 + 12);
    off += c.length;
    moviParts.push(c);
  });
  const moviSize = 4 + moviParts.reduce((a, c) => a + c.length, 0);
  const riffSize = 4 + hdrl.length + 8 + moviSize + 8 + idx.length;
  const fh = await fs.open(file, "w");
  try {
    await fh.write(Buffer.concat([fcc("RIFF"), u32(riffSize), fcc("AVI "), hdrl, fcc("LIST"), u32(moviSize), fcc("movi")]));
    for (const c of moviParts) await fh.write(c);
    await fh.write(Buffer.concat([fcc("idx1"), u32(idx.length), idx]));
  } finally {
    await fh.close();
  }
  return { file, fps, frames: seq.length, sourceFrames: frames.length, width: w, height: h, seconds: r1(seq.length / fps) };
}

// ---------------------------------------------------------------------------
// Cheater-vs-innocent parity probe: extra short rooms (OpenTDB blocked so the
// probe never touches the network) until a HUMAN context is dealt the cheater,
// then photograph role + first question on both phones at the same instant and
// pixel-diff them.
// ---------------------------------------------------------------------------
async function pixelDiff(browser, aBuf, bBuf, regions, diffFile) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  try {
    await page.setContent("<!doctype html><body></body>");
    const res = await page.evaluate(
      async ({ a, b, regions, scale }) => {
        const load = (src) => new Promise((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = bad; i.src = src; });
        const [ia, ib] = await Promise.all([load(a), load(b)]);
        const w = Math.min(ia.width, ib.width);
        const h = Math.min(ia.height, ib.height);
        const c = document.createElement("canvas");
        c.width = w;
        c.height = h;
        const g = c.getContext("2d", { willReadFrequently: true });
        g.drawImage(ia, 0, 0);
        const da = g.getImageData(0, 0, w, h).data;
        g.clearRect(0, 0, w, h);
        g.drawImage(ib, 0, 0);
        const db = g.getImageData(0, 0, w, h).data;
        const out = g.createImageData(w, h);
        const rc = regions.map((r) => ({ ...r, diffPx: 0 }));
        let count = 0, x0 = w, y0 = h, x1 = -1, y1 = -1, other = 0;
        for (let y = 0; y < h; y++)
          for (let x = 0; x < w; x++) {
            const i = (y * w + x) * 4;
            const d = Math.max(Math.abs(da[i] - db[i]), Math.abs(da[i + 1] - db[i + 1]), Math.abs(da[i + 2] - db[i + 2]));
            out.data[i] = db[i] * 0.3; out.data[i + 1] = db[i + 1] * 0.3; out.data[i + 2] = db[i + 2] * 0.3; out.data[i + 3] = 255;
            if (d > 16) {
              count++;
              if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y;
              out.data[i] = 255; out.data[i + 1] = 40; out.data[i + 2] = 200;
              const cx = x / scale, cy = y / scale;
              const r = rc.find((r) => cx >= r.x && cx < r.x + r.w && cy >= r.y && cy < r.y + r.h);
              if (r) r.diffPx++; else other++;
            }
          }
        g.putImageData(out, 0, 0);
        const r1 = (n) => Math.round(n * 10) / 10;
        return {
          imageW: w, imageH: h, threshold: "max channel delta > 16",
          diffPx: count,
          bboxCss: count ? { x: r1(x0 / scale), y: r1(y0 / scale), w: r1((x1 - x0 + 1) / scale), h: r1((y1 - y0 + 1) / scale) } : null,
          regions: rc, outsideRegionsPx: other,
          png: c.toDataURL("image/png"),
        };
      },
      { a: "data:image/png;base64," + aBuf.toString("base64"), b: "data:image/png;base64," + bBuf.toString("base64"), regions, scale: 2 },
    );
    await fs.writeFile(diffFile, Buffer.from(res.png.split(",")[1], "base64"));
    delete res.png;
    return res;
  } finally {
    await ctx.close();
  }
}

function probeFile(name) {
  shotN++;
  const file = `${String(shotN).padStart(2, "0")}-probe-${name}.png`;
  shots.push({ file, ctx: "probe", name, t: Date.now(), fullPage: false });
  return file;
}

async function parityProbe(browser, maxAttempts = 6) {
  const result = { attempts: [], found: false };
  for (let a = 1; a <= maxAttempts && !result.found; a++) {
    const h = await newPage(browser, `probe${a}-host`, false);
    const p = await newPage(browser, `probe${a}-player2`, false);
    try {
      for (const x of [h, p]) await x.context.route(/opentdb\.com/, (r) => r.abort());
      await h.page.goto(BASE, { waitUntil: "load" });
      await h.page.waitForSelector("#playerName");
      await h.page.fill("#playerName", "Host");
      await h.page.click("#hm-next");
      await h.page.click("[data-action=create]");
      await h.page.waitForSelector(".roomcode", { timeout: 15000 });
      const code = (await h.page.textContent(".roomcode")).trim();
      await p.page.goto(`${BASE}/#/join/${code}`, { waitUntil: "load" });
      await p.page.waitForSelector("#playerName");
      await p.page.fill("#playerName", "Player2");
      await p.page.click("#hm-next");
      await p.page.waitForSelector(".roomcode", { timeout: 15000 });
      for (let i = 0; i < 2; i++) {
        const before = await h.page.locator(".player-li").count();
        await h.page.click("[data-action=addBot]");
        await h.page.waitForFunction((n) => document.querySelectorAll(".player-li").length > n, before, { timeout: 5000 });
      }
      await h.page.click("[data-action=start]");
      await Promise.all([h.page.waitForSelector(".role-screen", { timeout: 30000 }), p.page.waitForSelector(".role-screen", { timeout: 30000 })]);
      await sleep(800);
      const roleData = (pg) => pg.evaluate(() => ({ samples: window.__cap.roleSamples, roleAt: window.__cap.phases.find((x) => x.phase === "role")?.domAt }));
      const [rh, rp] = await Promise.all([roleData(h.page), roleData(p.page)]);
      const hc = (rh.samples.at(-1)?.trimmedLen ?? 0) > 0;
      const pc = (rp.samples.at(-1)?.trimmedLen ?? 0) > 0;
      result.attempts.push({ attempt: a, room: code, cheater: hc ? "host" : pc ? "player2" : "bot" });
      log(`[probe] attempt ${a}: cheater is ${hc ? "host" : pc ? "player2" : "a bot"}`);
      if (!hc && !pc) continue;
      result.found = true;
      result.cheaterCtx = hc ? "host" : "player2";
      const [cheat, inno] = hc ? [h, p] : [p, h];
      const [rc, ri] = hc ? [rh, rp] : [rp, rh];
      const summarizeRole = (r) => {
        const last = r.samples.at(-1);
        const firstWithFinal = r.samples.find((s) => s.text === last.text);
        return { text: last.text, chars: last.trimmedLen, box: last.box, renders: r.samples.length, textChanged: new Set(r.samples.map((s) => s.text)).size > 1, finalTextAfterMs: r1(firstWithFinal.t - r.roleAt), screenText: last.screenText };
      };
      result.role = { cheater: summarizeRole(rc), innocent: summarizeRole(ri) };

      // Same instant on both phones
      const [bc, bi] = await Promise.all([cheat.page.screenshot(), inno.page.screenshot()]);
      const fc = probeFile("cheater-role");
      const fi = probeFile("innocent-role");
      await fs.writeFile(path.join(OUT, fc), bc);
      await fs.writeFile(path.join(OUT, fi), bi);
      const roleRegions = [{ name: ".role-extra", ...rc.samples.at(-1).box }];
      const fd = probeFile("role-diff");
      result.roleDiff = { files: [fc, fi, fd], ...(await pixelDiff(browser, bc, bi, roleRegions, path.join(OUT, fd))) };

      // First question: the sanctioned marker should be the ONLY difference.
      await Promise.all([cheat.page.waitForSelector(".timer-wrap", { timeout: 20000 }), inno.page.waitForSelector(".timer-wrap", { timeout: 20000 })]);
      await sleep(400);
      const geo = (pg) =>
        pg.evaluate(() => {
          const r1 = (n) => Math.round(n * 100) / 100;
          const R = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { x: r1(r.x), y: r1(r.y), w: r1(r.width), h: r1(r.height) }; };
          return {
            opts: [...document.querySelectorAll(".opt")].map((o) => {
              const cs = getComputedStyle(o);
              const af = getComputedStyle(o, "::after");
              const spans = o.querySelectorAll("span");
              return { cls: o.className.replace(/\s+/g, " ").trim(), rect: R(o), borderWidth: cs.borderTopWidth, borderColor: cs.borderTopColor, afterContent: af.content, afterBg: af.backgroundColor, letterRect: R(spans[0]), textRect: R(spans[1]) };
            }),
            timer: R(document.querySelector(".timer-wrap")),
            qtext: R(document.querySelector(".qtext")),
            head: R(document.querySelector(".qhead")),
            // Normalise the per-client clock bits (deadline attrs, ticking countdown
            // text, the ring's inline dashoffset) and drop the sanctioned marker.
            htmlNoMarker: (() => {
              const c = document.getElementById("app").cloneNode(true);
              c.querySelectorAll(".cheat-mark").forEach((e) => e.classList.remove("cheat-mark"));
              c.querySelectorAll(".timer-arc").forEach((e) => { e.removeAttribute("style"); e.removeAttribute("data-deadline"); });
              c.querySelectorAll("[data-count]").forEach((e) => { e.textContent = ""; e.removeAttribute("data-count"); });
              // Class strings are built with join(" "), so "opt  " vs "opt cheat-mark " — compare token sets.
              c.querySelectorAll("[class]").forEach((e) => e.setAttribute("class", [...e.classList].sort().join(" ")));
              return c.innerHTML.replace(/\s+/g, " ");
            })(),
          };
        });
      const [qc, qi] = await Promise.all([cheat.page.screenshot(), inno.page.screenshot()]);
      const [gc, gi] = await Promise.all([geo(cheat.page), geo(inno.page)]);
      const fqc = probeFile("cheater-question");
      const fqi = probeFile("innocent-question");
      await fs.writeFile(path.join(OUT, fqc), qc);
      await fs.writeFile(path.join(OUT, fqi), qi);
      const qRegions = [
        ...gc.opts.map((o, i) => ({ name: `.opt[${i}]${o.cls.includes("cheat-mark") ? " (cheat-mark)" : ""}`, ...o.rect })),
        { name: ".qhead (timer + Q#)", ...gc.head },
        { name: ".qtext", ...gc.qtext },
      ];
      const fqd = probeFile("question-diff");
      const qd = await pixelDiff(browser, qc, qi, qRegions, path.join(OUT, fqd));
      const geoDiffs = [];
      gc.opts.forEach((o, i) => {
        const n = gi.opts[i];
        for (const k of ["rect", "letterRect", "textRect"]) if (JSON.stringify(o[k]) !== JSON.stringify(n[k])) geoDiffs.push({ opt: i, cheatMark: o.cls.includes("cheat-mark"), prop: k, cheater: o[k], innocent: n[k] });
        for (const k of ["borderWidth", "borderColor", "afterContent", "afterBg"]) if (o[k] !== n[k]) geoDiffs.push({ opt: i, cheatMark: o.cls.includes("cheat-mark"), prop: k, cheater: o[k], innocent: n[k] });
      });
      let firstDomDiff = null;
      if (gc.htmlNoMarker !== gi.htmlNoMarker) {
        let k = 0;
        while (k < gc.htmlNoMarker.length && gc.htmlNoMarker[k] === gi.htmlNoMarker[k]) k++;
        firstDomDiff = { at: k, cheater: gc.htmlNoMarker.slice(Math.max(0, k - 60), k + 80), innocent: gi.htmlNoMarker.slice(Math.max(0, k - 60), k + 80) };
      }
      result.question = { files: [fqc, fqi, fqd], pixelDiff: qd, geometryDiffs: geoDiffs, domIdenticalApartFromMarker: gc.htmlNoMarker === gi.htmlNoMarker, firstDomDiff };
    } catch (e) {
      log(`[probe] attempt ${a} error: ${e.message.split("\n")[0]}`);
      result.attempts.push({ attempt: a, error: e.message.split("\n")[0] });
    } finally {
      await h.context.close().catch(() => {});
      await p.context.close().catch(() => {});
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Analysis helpers
// ---------------------------------------------------------------------------
const quant = (sorted, p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] : null);
const r1 = (n) => (n === null || n === undefined || Number.isNaN(n) ? null : Math.round(n * 10) / 10);

function frameStats(dts) {
  if (!dts.length) return { count: 0 };
  const s = [...dts].sort((a, b) => a - b);
  const mean = dts.reduce((a, b) => a + b, 0) / dts.length;
  return {
    count: dts.length,
    meanFps: r1(1000 / mean),
    p50: r1(quant(s, 0.5)),
    p95: r1(quant(s, 0.95)),
    p99: r1(quant(s, 0.99)),
    max: r1(s[s.length - 1]),
    over18: dts.filter((d) => d > 18.2).length,
    over33: dts.filter((d) => d > 33.4).length,
    over50: dts.filter((d) => d > 50).length,
    pctOver18: r1((100 * dts.filter((d) => d > 18.2).length) / dts.length),
  };
}

// A frame interval [t-dt, t] is "dirty" if it overlaps a screenshot (any
// context) or one of this page's own layout-check passes.
function dirtyFrame(t, dt, checkWindows) {
  const a0 = t - dt;
  for (const [a, b] of shotWindows) if (t >= a - 50 && a0 <= b + 250) return true;
  for (const [a, b] of checkWindows) if (t >= a && a0 <= b + 20) return true;
  return false;
}

function analyzeContext(name, cap) {
  const phases = cap.phases.map((p, i) => ({
    ...p,
    domAt: r1(p.domAt),
    paintAt: r1(p.paintAt),
    durMs: cap.phases[i + 1] ? r1(cap.phases[i + 1].domAt - p.domAt) : null,
  }));
  const byInst = (i) => phases[i];

  // Frames
  const buckets = {};
  const clean = {};
  const push = (obj, k, v) => (obj[k] ??= []).push(v);
  for (let i = 0; i < cap.frames.length; i += 3) {
    const t = cap.frames[i];
    const dt = cap.frames[i + 1];
    const inst = cap.frames[i + 2];
    const ph = byInst(inst);
    if (!ph || ph.phase === "boot") continue;
    const entry = t - ph.domAt <= 2000;
    push(buckets, ph.phase, dt);
    if (entry) push(buckets, ph.phase + "@entry2s", dt);
    if (!dirtyFrame(t, dt, cap.checkWindows)) {
      push(clean, ph.phase, dt);
      if (entry) push(clean, ph.phase + "@entry2s", dt);
    }
  }
  const frames = {};
  for (const k of Object.keys(buckets)) frames[k] = { raw: frameStats(buckets[k]), clean: frameStats(clean[k] ?? []) };

  // Vsync estimate + per-instance entry cost (worst frame within 500 ms of the screen's DOM swap)
  const allDts = [];
  for (let i = 1; i < cap.frames.length; i += 3) allDts.push(cap.frames[i]);
  const vsyncMs = r1(quant([...allDts].sort((a, b) => a - b), 0.5));
  const entryWorst = {};
  for (let i = 0; i < cap.frames.length; i += 3) {
    const t = cap.frames[i];
    const dt = cap.frames[i + 1];
    const ph = byInst(cap.frames[i + 2]);
    if (!ph || ph.phase === "boot" || t - ph.domAt > 500 || dirtyFrame(t, dt, cap.checkWindows)) continue;
    entryWorst[ph.inst] = Math.max(entryWorst[ph.inst] ?? 0, dt);
  }
  const entry = {};
  for (const p of phases) {
    if (p.phase === "boot" || entryWorst[p.inst] === undefined) continue;
    const o = (entry[p.phase] ??= { first: null, firstKey: null, others: [] });
    if (o.first === null) { o.first = r1(entryWorst[p.inst]); o.firstKey = `${p.key}#${p.occ}`; o.firstPaintDelayMs = r1(p.paintAt - p.domAt); }
    else o.others.push(entryWorst[p.inst]);
  }
  for (const o of Object.values(entry)) {
    o.othersMean = o.others.length ? r1(o.others.reduce((a, b) => a + b, 0) / o.others.length) : null;
    o.othersMax = o.others.length ? r1(Math.max(...o.others)) : null;
    o.othersN = o.others.length;
    delete o.others;
  }

  // Renders (records = innerHTML replacements; batches = observer callbacks)
  const rendersByPhase = {};
  const batchesByPhase = {};
  const rendersByInst = {};
  for (const r of cap.renders) {
    const n = r.records ?? 1;
    rendersByPhase[r.phase] = (rendersByPhase[r.phase] ?? 0) + n;
    batchesByPhase[r.phase] = (batchesByPhase[r.phase] ?? 0) + 1;
    rendersByInst[r.inst] = (rendersByInst[r.inst] ?? 0) + n;
  }
  const renderInstStats = {};
  for (const p of phases) {
    if (p.phase === "boot") continue;
    (renderInstStats[p.phase] ??= []).push(rendersByInst[p.inst] ?? 0);
  }
  const renders = {};
  for (const [ph, arr] of Object.entries(renderInstStats))
    renders[ph] = { total: rendersByPhase[ph] ?? 0, batches: batchesByPhase[ph] ?? 0, instances: arr.length, perInstanceMean: r1(arr.reduce((a, b) => a + b, 0) / arr.length), perInstanceMax: Math.max(...arr) };

  // Animation restarts
  const starts = cap.anims.filter((a) => a.type === "animationstart");
  const groups = {};
  for (const a of starts) {
    const k = `${a.inst}|${a.name}|${a.cls}`;
    (groups[k] ??= { inst: a.inst, key: byInst(a.inst)?.key, phase: a.phase, name: a.name, cls: a.cls, count: 0, times: [] });
    groups[k].count++;
    groups[k].times.push(r1(a.t - (byInst(a.inst)?.domAt ?? a.t)));
  }
  const restarts = Object.values(groups).filter((g) => g.count > 1);
  const animsByPhase = {};
  for (const a of starts) {
    const o = (animsByPhase[a.phase] ??= {});
    const k = `${a.name} on .${String(a.cls).split(/\s+/).join(".")}`;
    o[k] = (o[k] ?? 0) + 1;
  }

  // Transitions
  const transSummary = {};
  for (const t of cap.trans) {
    const k = `${t.prop} on .${String(t.cls).split(/\s+/).join(".")}`;
    const o = (transSummary[k] ??= { transitionrun: 0, transitionstart: 0, transitionend: 0, transitioncancel: 0, phases: {} });
    o[t.type]++;
    o.phases[t.phase] = (o.phases[t.phase] ?? 0) + 1;
  }
  const fillTrans = cap.trans.filter((t) => String(t.cls).split(/\s+/).includes("fill") && t.prop === "width");

  // Long tasks (attributed by timestamp)
  const phaseAt = (t) => {
    let ph = phases[0];
    for (const p of phases) if (p.domAt <= t) ph = p;
    return ph;
  };
  const longByPhase = {};
  const longRaw = cap.longtasks.map((lt) => {
    const p = phaseAt(lt.t);
    return { ...lt, at: `${p.key}#${p.occ}`, msAfterPhaseStart: r1(lt.t - p.domAt) };
  });
  for (const lt of cap.longtasks) {
    const ph = phaseAt(lt.t).phase;
    const o = (longByPhase[ph] ??= { count: 0, totalMs: 0, maxMs: 0 });
    o.count++;
    o.totalMs = r1(o.totalMs + lt.dur);
    o.maxMs = Math.max(o.maxMs, lt.dur);
  }

  // Layout (merged per phase type)
  const layout = {};
  for (const l of cap.layout) {
    const o = (layout[l.phase] ??= { checks: 0, overflowX: false, maxScrollWidth: 0, maxScrollHeight: 0, wide: {}, small: {}, ellipsis: {}, fold: {} });
    o.checks++;
    if (l.overflowX || l.scrollHeight > l.vh) (o.overflowAt ??= []).push(`${l.key} +${r1(l.t - (byInst(l.inst)?.domAt ?? l.t))}ms: ${l.scrollWidth}x${l.scrollHeight}`);
    o.overflowX ||= l.overflowX;
    o.maxScrollWidth = Math.max(o.maxScrollWidth, l.scrollWidth);
    o.maxScrollHeight = Math.max(o.maxScrollHeight, l.scrollHeight);
    for (const w of l.wide) o.wide[w.sel] = w;
    for (const s of l.small) {
      const prev = o.small[s.sel];
      if (!prev || s.w * s.h < prev.w * prev.h) o.small[s.sel] = s;
    }
    for (const e of l.ellipsis) o.ellipsis[`${e.sel}|${e.text}`] = e;
    for (const [sel, f] of Object.entries(l.fold)) {
      const prev = o.fold[sel];
      if (!prev) o.fold[sel] = { ...f, belowFoldInstances: f.fullyAboveFold ? 0 : 1, instances: 1 };
      else {
        prev.instances++;
        if (!f.fullyAboveFold) prev.belowFoldInstances++;
        prev.bottom = Math.max(prev.bottom, f.bottom);
      }
    }
  }
  for (const o of Object.values(layout)) {
    o.wide = Object.values(o.wide);
    o.small = Object.values(o.small);
    o.ellipsis = Object.values(o.ellipsis);
  }

  // Role tell
  const rs = cap.roleSamples;
  const role = rs.length
    ? {
        samples: rs.length,
        first: rs[0],
        last: rs[rs.length - 1],
        textChangedDuringRole: new Set(rs.map((x) => x.text)).size > 1,
        msUntilFinalText: r1(rs.find((x) => x.text === rs[rs.length - 1].text).t - (phases.find((p) => p.phase === "role")?.domAt ?? rs[0].t)),
      }
    : null;

  return {
    name,
    phases,
    marks: cap.marks.map((m) => ({ ...m, t: r1(m.t), sinceInstMs: r1(m.t - (byInst(m.inst)?.domAt ?? m.t)) })),
    frames,
    renders,
    renderEvents: cap.renders.map((r) => ({ ...r, t: r1(r.t), sinceInstMs: r1(r.t - (byInst(r.inst)?.domAt ?? r.t)) })),
    animations: { startsByPhase: animsByPhase, restarts, totalStarts: starts.length, raw: cap.anims.map((a) => ({ ...a, t: r1(a.t) })) },
    transitions: { summary: transSummary, gradeBookFillWidth: { events: fillTrans.length, ran: fillTrans.some((t) => t.type === "transitionrun") } },
    longtasks: { total: cap.longtasks.length, totalMs: r1(cap.longtasks.reduce((a, b) => a + b.dur, 0)), byPhase: longByPhase, raw: longRaw },
    vsyncMs,
    entry,
    layout,
    layoutRaw: cap.layout,
    role,
    errors: cap.errors,
    framesRaw: cap.frames,
  };
}

function syncReport(a, b) {
  const kinds = ["role", "question", "reveal", "vote", "voteResult", "matchEnd", "sessionEnd"];
  const mapOf = (ctx) => Object.fromEntries(ctx.phases.filter((p) => kinds.includes(p.phase)).map((p) => [`${p.key}#${p.occ}`, p]));
  const A = mapOf(a);
  const B = mapOf(b);
  const rows = [];
  for (const k of Object.keys(A)) {
    if (!B[k]) continue;
    rows.push({
      key: k,
      phase: A[k].phase,
      hostDomAt: A[k].domAt,
      p2DomAt: B[k].domAt,
      domDiffMs: r1(B[k].domAt - A[k].domAt),
      paintDiffMs: A[k].paintAt && B[k].paintAt ? r1(B[k].paintAt - A[k].paintAt) : null,
    });
  }
  const summarize = (arr) => {
    const abs = arr.filter((x) => x !== null).map(Math.abs);
    if (!abs.length) return null;
    const signed = arr.filter((x) => x !== null);
    return {
      n: abs.length,
      meanAbs: r1(abs.reduce((x, y) => x + y, 0) / abs.length),
      meanSigned: r1(signed.reduce((x, y) => x + y, 0) / signed.length),
      p95Abs: r1(quant([...abs].sort((x, y) => x - y), 0.95)),
      maxAbs: r1(Math.max(...abs)),
      within150: abs.filter((x) => x <= 150).length,
    };
  };
  const byPhase = {};
  for (const ph of kinds) {
    const rr = rows.filter((r) => r.phase === ph);
    if (rr.length) byPhase[ph] = { dom: summarize(rr.map((r) => r.domDiffMs)), paint: summarize(rr.map((r) => r.paintDiffMs)) };
  }
  return { note: "positive = Player2 later than host (host renders via local loopback; Player2 via relay socket)", all: { dom: summarize(rows.map((r) => r.domDiffMs)), paint: summarize(rows.map((r) => r.paintDiffMs)) }, byPhase, rows };
}

function matchTiming(ctx) {
  const ph = ctx.phases;
  const role = ph.find((p) => p.phase === "role");
  const end = ph.find((p) => p.phase === "matchEnd");
  const sum = (f) => r1(ph.filter(f).reduce((a, p) => a + (p.durMs ?? 0), 0));
  const durs = (name) => ph.filter((p) => p.phase === name && p.durMs !== null).map((p) => ({ key: `${p.key}#${p.occ}`, ms: p.durMs }));
  return {
    roleToMatchEndMs: role && end ? r1(end.domAt - role.domAt) : null,
    totals: { question: sum((p) => p.phase === "question"), reveal: sum((p) => p.phase === "reveal"), vote: sum((p) => p.phase === "vote"), voteResult: sum((p) => p.phase === "voteResult"), role: sum((p) => p.phase === "role") },
    questionDurations: durs("question"),
    revealDurations: durs("reveal"),
    voteDurations: durs("vote"),
    voteResultDurations: durs("voteResult"),
  };
}

// ---------------------------------------------------------------------------
// Markdown
// ---------------------------------------------------------------------------
const fmt = (v) => (v === null || v === undefined ? "–" : String(v));
function table(headers, rows) {
  return [`| ${headers.join(" | ")} |`, `| ${headers.map(() => "---").join(" | ")} |`, ...rows.map((r) => `| ${r.map(fmt).join(" | ")} |`)].join("\n");
}

function buildMarkdown(rep) {
  const L = [];
  const H = rep.contexts.host;
  const P = rep.contexts.player2;
  const order = ["home", "lobby", "role", "question", "question@entry2s", "reveal", "reveal@entry2s", "vote", "vote@entry2s", "voteResult", "voteResult@entry2s", "matchEnd", "matchEnd@entry2s", "sessionEnd"];
  L.push(`# Current build baseline — capture report`);
  L.push("");
  L.push(`Generated ${rep.meta.generatedAt} by \`tools/capture-current.mjs\`. ${rep.meta.browser}, headless, viewport ${VIEWPORT.width}x${VIEWPORT.height} @2x, isMobile+hasTouch, CPU throttle ${THROTTLE}x on every page. Host context video-recorded.`);
  L.push("");
  L.push(`Match: 4 players (Host, Player2, 2 host-side bots). Cheater: **${rep.outcome.cheater}**. End: **${rep.outcome.endBanner ?? "?"}** after ${rep.outcome.revealsSeenByHost} reveals. Vote(s): ${rep.outcome.votes.join("; ") || "none"}. Offline-question chip shown: ${rep.outcome.offlineChip}. Run wall time ${r1(rep.meta.wallMs / 1000)}s.`);
  L.push("");
  L.push(`Caveats: headless Edge on a desktop CPU with Chrome's CPU throttle is a proxy for a mid/low-end phone, not a measurement of one; video recording and screenshots also cost frames. "Clean" frame numbers exclude frames within 50 ms before to 250 ms after any screenshot. Both contexts share one machine clock, so sync numbers are relay + render latency only (no clock skew).`);
  L.push("");

  L.push(`## Frame timing (rAF intervals, clean)`);
  L.push("");
  for (const [label, ctx] of [["Host", H], ["Player2", P]]) {
    L.push(`**${label}**`);
    L.push("");
    const rows = order.filter((k) => ctx.frames[k]).map((k) => {
      const c = ctx.frames[k].clean;
      return [k, c.count, c.meanFps, c.p50, c.p95, c.p99, c.max, c.over18, c.over33, c.over50];
    });
    L.push(table(["phase", "frames", "mean fps", "p50 ms", "p95 ms", "p99 ms", "max ms", ">18ms", ">33ms", ">50ms"], rows));
    L.push("");
  }
  const rawRev = H.frames.reveal?.raw;
  if (rawRev) L.push(`Host reveal including screenshot windows: ${rawRev.count} frames, mean ${rawRev.meanFps} fps, p95 ${rawRev.p95} ms, max ${rawRev.max} ms.`);
  L.push("");
  L.push(`Measured vsync interval (median rAF delta): host ${H.vsyncMs} ms, Player2 ${P.vsyncMs} ms (≈${r1(1000 / H.vsyncMs)} Hz — headless Edge follows this machine's display rate, so "mean fps" is capped there, not at 60).`);
  L.push("");
  L.push(`**Screen-entry cost** — worst frame within 500 ms of each screen's DOM swap (clean). The first time a screen type renders it pays style/layout/emoji-raster cost; later instances are cheap.`);
  L.push("");
  const entryRows = [];
  for (const ph of ["home", "lobby", "role", "question", "reveal", "vote", "voteResult", "matchEnd", "sessionEnd"]) {
    const a = H.entry[ph];
    const b = P.entry[ph];
    if (!a && !b) continue;
    entryRows.push([ph, a?.first, a?.firstPaintDelayMs, a?.othersN ? `${a.othersMean} / ${a.othersMax} (n=${a.othersN})` : "–", b?.first, b?.othersN ? `${b.othersMean} / ${b.othersMax} (n=${b.othersN})` : "–"]);
  }
  L.push(table(["screen", "host 1st instance worst frame ms", "host 1st: DOM swap → next rAF ms", "host later instances mean/max ms", "P2 1st instance worst frame ms", "P2 later mean/max ms"], entryRows));
  L.push("");

  L.push(`## Full #app re-renders (innerHTML replacement)`);
  L.push("");
  L.push(`Every \`state\` and every \`secret\` message calls \`render()\`, which replaces all of \`#app\`. Counted per \`innerHTML\` assignment (MutationObserver record on \`#app\`), attributed to the screen showing when the observer fires.`);
  L.push("");
  const rphs = [...new Set([...Object.keys(H.renders), ...Object.keys(P.renders)])].filter((p) => p !== "boot" && p !== "unknown");
  L.push(table(["phase", "host total", "host instances", "host per-instance mean/max", "P2 total", "P2 instances", "P2 per-instance mean/max"], rphs.map((ph) => [ph, H.renders[ph]?.total, H.renders[ph]?.instances, H.renders[ph] ? `${H.renders[ph].perInstanceMean} / ${H.renders[ph].perInstanceMax}` : null, P.renders[ph]?.total, P.renders[ph]?.instances, P.renders[ph] ? `${P.renders[ph].perInstanceMean} / ${P.renders[ph].perInstanceMax}` : null])));
  L.push("");
  const tot = (c) => c.renderEvents.reduce((a, e) => a + (e.records ?? 1), 0);
  L.push(`Total full re-renders: host ${tot(H)} (${H.renderEvents.length} observer batches), Player2 ${tot(P)} (${P.renderEvents.length} batches).`);
  L.push("");

  L.push(`## CSS animations`);
  L.push("");
  for (const [label, ctx] of [["Host", H], ["Player2", P]]) {
    L.push(`**${label}** — ${ctx.animations.totalStarts} animationstart events.`);
    L.push("");
    const rows = [];
    for (const [ph, o] of Object.entries(ctx.animations.startsByPhase)) for (const [k, n] of Object.entries(o)) rows.push([ph, k, n]);
    if (rows.length) L.push(table(["phase", "animation", "starts"], rows));
    L.push("");
    if (ctx.animations.restarts.length) {
      L.push(`Restarted within one phase instance:`);
      L.push("");
      L.push(table(["instance", "animation", "element", "starts", "ms after phase start"], ctx.animations.restarts.map((g) => [g.key, g.name, g.cls, g.count, g.times.join(", ")])));
    } else L.push(`No animation restarted within a phase instance.`);
    L.push("");
  }
  const phasesWithAnims = new Set(Object.keys(H.animations.startsByPhase));
  const silent = ["role", "question", "reveal"].filter((p) => !phasesWithAnims.has(p));
  if (silent.length) L.push(`Phases with **zero** CSS animations on the host: ${silent.join(", ")}.`);
  L.push("");

  L.push(`## Transitions`);
  L.push("");
  for (const [label, ctx] of [["Host", H], ["Player2", P]]) {
    const rows = Object.entries(ctx.transitions.summary).map(([k, o]) => [k, o.transitionrun, o.transitionend, o.transitioncancel, Object.entries(o.phases).map(([p, n]) => `${p}:${n}`).join(" ")]);
    L.push(`**${label}** — grade-book \`.fill\` width transition events: ${ctx.transitions.gradeBookFillWidth.events} (ran: ${ctx.transitions.gradeBookFillWidth.ran ? "yes" : "**never**"}). Transition events of any kind: ${Object.values(ctx.transitions.summary).reduce((a, o) => a + o.transitionrun, 0)}.`);
    L.push("");
    if (rows.length) L.push(table(["property on element", "run", "end", "cancel", "by phase"], rows));
    L.push("");
  }
  L.push(`\`.bar-row .fill { transition: width 0.6s }\` is dead code: each reveal inserts brand-new bars already at their final width, so there is no "from" value to transition from.`);
  L.push("");

  L.push(`## Long tasks (>50 ms main-thread)`);
  L.push("");
  L.push(table(["phase", "host count", "host total ms", "host max ms", "P2 count", "P2 total ms", "P2 max ms"], [...new Set([...Object.keys(H.longtasks.byPhase), ...Object.keys(P.longtasks.byPhase)])].map((ph) => [ph, H.longtasks.byPhase[ph]?.count, H.longtasks.byPhase[ph]?.totalMs, H.longtasks.byPhase[ph]?.maxMs, P.longtasks.byPhase[ph]?.count, P.longtasks.byPhase[ph]?.totalMs, P.longtasks.byPhase[ph]?.maxMs])));
  L.push("");
  L.push(`Totals: host ${H.longtasks.total} (${H.longtasks.totalMs} ms), Player2 ${P.longtasks.total} (${P.longtasks.totalMs} ms).`);
  L.push("");
  L.push(table(["ctx", "duration ms", "during", "ms after screen start"], [...H.longtasks.raw.map((t) => ["host", t.dur, t.at, t.msAfterPhaseStart]), ...P.longtasks.raw.map((t) => ["P2", t.dur, t.at, t.msAfterPhaseStart])]));
  L.push("");

  L.push(`## Layout checks at 380px`);
  L.push("");
  const lrows = [];
  for (const [label, ctx] of [["host", H], ["P2", P]])
    for (const [ph, o] of Object.entries(ctx.layout)) lrows.push([label, ph, o.checks, o.overflowX ? `**yes** (${o.maxScrollWidth}px)` : "no", o.maxScrollHeight, o.small.length, o.ellipsis.length]);
  L.push(table(["ctx", "phase", "checks", "horizontal overflow", "max page height px", "targets <44px", "ellipsized texts"], lrows));
  L.push("");
  const ovRows = [];
  for (const [label, ctx] of [["host", H], ["P2", P]]) for (const [ph, o] of Object.entries(ctx.layout)) for (const s of o.overflowAt ?? []) ovRows.push([label, ph, s]);
  if (ovRows.length) {
    L.push(`Checks where the page was wider or taller than the 380x800 viewport (scrollWidth x scrollHeight, ms after the screen appeared):`);
    L.push("");
    L.push(table(["ctx", "phase", "when / size"], ovRows));
    L.push("");
  }
  L.push(`Tap targets under 44px (host, all phases, smallest seen):`);
  L.push("");
  const smallAll = {};
  for (const [ph, o] of Object.entries(H.layout)) for (const s of o.small) (smallAll[s.sel] ??= { ...s, phases: new Set() }).phases.add(ph);
  for (const [ph, o] of Object.entries(P.layout)) for (const s of o.small) (smallAll[s.sel] ??= { ...s, phases: new Set() }).phases.add("P2:" + ph);
  L.push(table(["element", "w x h", "text", "phases"], Object.values(smallAll).map((s) => [`\`${s.sel}\``, `${s.w} x ${s.h}`, s.text, [...s.phases].join(", ")])));
  L.push("");
  L.push(`Ellipsized (truncated) text:`);
  L.push("");
  const ell = {};
  for (const [ph, o] of Object.entries(H.layout)) for (const e of o.ellipsis) (ell[`${e.sel}|${e.text}`] ??= { ...e, phases: new Set() }).phases.add(ph);
  L.push(table(["element", "full text", "needs/has px", "phases"], Object.values(ell).map((e) => [`\`${e.sel}\``, e.text, `${e.scrollW}/${e.clientW}`, [...e.phases].join(", ")])));
  L.push("");
  const foldRows = [];
  for (const ph of ["reveal", "vote", "lobby", "matchEnd", "question"]) {
    const o = H.layout[ph];
    if (!o) continue;
    for (const [sel, f] of Object.entries(o.fold)) foldRows.push([ph, `\`${sel}\``, f.count, f.top, f.bottom, `${f.belowFoldInstances}/${f.instances}`]);
  }
  L.push(`Above/below the 800px fold (host; page y-coordinates):`);
  L.push("");
  L.push(table(["phase", "element", "count", "top px", "bottom px", "instances extending below fold"], foldRows));
  L.push("");

  L.push(`## Role-screen tell`);
  L.push("");
  const roleRow = (label, r) => (r ? [label, JSON.stringify(r.last.text), r.last.trimmedLen, r.last.empty ? "empty" : "TEXT", `${r.last.box.w} x ${r.last.box.h} @ y${r.last.box.y}`, r.textChangedDuringRole ? `yes (final text after ${r.msUntilFinalText} ms)` : "no"] : [label, "not captured"]);
  L.push(table(["ctx", ".role-extra text", "chars", "state", "box", "changed while on screen"], [roleRow("host", H.role), roleRow("Player2", P.role)]));
  L.push("");
  L.push(rep.roleTell.summary);
  L.push("");
  const PR = rep.parityProbe;
  if (PR) {
    L.push(`### Parity probe (human cheater, same instant on both phones)`);
    L.push("");
    L.push(`Extra rooms dealt until a human held the cheater role (OpenTDB blocked in probe rooms): ${PR.attempts.map((a) => `#${a.attempt} → ${a.cheater ?? "error: " + a.error}`).join(", ")}.`);
    L.push("");
    if (PR.found) {
      const c = PR.role.cheater;
      const i = PR.role.innocent;
      L.push(table(["", "cheater (" + PR.cheaterCtx + ")", "innocent"], [
        [".role-extra text", JSON.stringify(c.text), JSON.stringify(i.text)],
        ["visible chars", c.chars, i.chars],
        ["box", `${c.box.w} x ${c.box.h} @ ${c.box.x},${c.box.y}`, `${i.box.w} x ${i.box.h} @ ${i.box.x},${i.box.y}`],
        ["text changed while on screen", c.textChanged ? `yes — final text ${c.finalTextAfterMs} ms after the screen appeared` : "no", i.textChanged ? "yes" : "no"],
      ]));
      L.push("");
      const rd = PR.roleDiff;
      L.push(`Role screen pixel diff (\`${rd.files[2]}\`): **${rd.diffPx} px differ** (${rd.threshold}), bounding box ${rd.bboxCss ? `${rd.bboxCss.w} x ${rd.bboxCss.h} CSS px at ${rd.bboxCss.x},${rd.bboxCss.y}` : "none"}; inside \`.role-extra\`: ${rd.regions[0]?.diffPx}, elsewhere: ${rd.outsideRegionsPx}.`);
      L.push("");
      if (PR.question) {
        const q = PR.question;
        L.push(`Question screen (\`${q.files[0]}\` vs \`${q.files[1]}\`, diff \`${q.files[2]}\`): ${q.pixelDiff.diffPx} px differ. DOM identical apart from the \`cheat-mark\` class (clock-driven countdown text/ring offsets normalised): ${q.domIdenticalApartFromMarker ? "yes" : "**no**"}.`);
        L.push("");
        if (q.firstDomDiff) {
          L.push(`First DOM difference — cheater: \`${q.firstDomDiff.cheater.replace(/`/g, "'")}\` / innocent: \`${q.firstDomDiff.innocent.replace(/`/g, "'")}\``);
          L.push("");
        }
        L.push(table(["region", "differing px"], [...q.pixelDiff.regions.map((r) => [r.name, r.diffPx]), ["outside listed regions", q.pixelDiff.outsideRegionsPx]]));
        L.push("");
        if (q.geometryDiffs.length) {
          L.push(`Geometry/style differences between the two phones' option buttons:`);
          L.push("");
          L.push(table(["option", "cheat-mark", "property", "cheater", "innocent"], q.geometryDiffs.map((d) => [d.opt, d.cheatMark ? "yes" : "", d.prop, typeof d.cheater === "object" ? JSON.stringify(d.cheater) : d.cheater, typeof d.innocent === "object" ? JSON.stringify(d.innocent) : d.innocent])));
          L.push("");
        }
      }
    }
  }

  L.push(`## Cross-client sync (host vs Player2, same machine clock)`);
  L.push("");
  const S = rep.sync;
  L.push(table(["phase", "n", "DOM mean |Δ| ms", "DOM max |Δ| ms", "first-frame mean |Δ| ms", "first-frame max |Δ| ms", "mean signed (P2-host)"], Object.entries(S.byPhase).map(([ph, o]) => [ph, o.dom?.n, o.dom?.meanAbs, o.dom?.maxAbs, o.paint?.meanAbs, o.paint?.maxAbs, o.dom?.meanSigned])));
  L.push("");
  if (S.all.dom) L.push(`All transitions: n=${S.all.dom.n}, DOM mean |Δ| ${S.all.dom.meanAbs} ms, p95 ${S.all.dom.p95Abs} ms, max ${S.all.dom.maxAbs} ms (${S.all.dom.within150}/${S.all.dom.n} within 150 ms); first-frame mean |Δ| ${S.all.paint?.meanAbs} ms, max ${S.all.paint?.maxAbs} ms. ${S.note}.`);
  L.push("");
  L.push(`Note: the current build has no beat timeline at all. Each client renders the whole reveal the instant its state packet arrives, so this is "packet arrival" skew on localhost only; on real phones over Wi-Fi/LTE the relay hop adds tens to hundreds of ms per client.`);
  L.push("");

  L.push(`## Match pacing (host)`);
  L.push("");
  const MT = rep.matchTiming;
  L.push(`Role → match end: ${r1((MT.roleToMatchEndMs ?? 0) / 1000)} s. Time on screen: question ${r1(MT.totals.question / 1000)} s, reveal ${r1(MT.totals.reveal / 1000)} s, vote ${r1(MT.totals.vote / 1000)} s, voteResult ${r1(MT.totals.voteResult / 1000)} s.`);
  L.push("");
  L.push(table(["screen", "durations (s)"], [
    ["question", MT.questionDurations.map((d) => r1(d.ms / 1000)).join(", ")],
    ["reveal", MT.revealDurations.map((d) => `${d.key.replace("reveal:", "")}=${r1(d.ms / 1000)}`).join(", ")],
    ["vote", MT.voteDurations.map((d) => r1(d.ms / 1000)).join(", ")],
    ["voteResult", MT.voteResultDurations.map((d) => r1(d.ms / 1000)).join(", ")],
  ]));
  L.push("");
  L.push(`Reveal dwell is set by the 8 s \`revealMinMs\` gate plus the host's tap (this script taps 1 s after it enables). Nothing on the reveal moves after its first frame.`);
  L.push("");

  L.push(`## Screenshots`);
  L.push("");
  L.push(table(["file", "context", "screen"], [...rep.screenshots].sort((a, b) => a.file.localeCompare(b.file)).map((s) => [`\`${s.file}\``, s.ctx, s.name + (s.fullPage ? " (full page)" : "")])));
  L.push("");
  const V = rep.meta.video;
  L.push(V ? `Video: \`${V.file}\` (host context; ${V.mode}${V.frames ? `; ${V.width}x${V.height}, ${V.fps} fps, ${V.seconds} s, ${V.sourceFrames} captured frames` : ""}).` : `Video: not captured.`);
  L.push("");
  return L.join("\n");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function writeMarkdown(report) {
  let md = buildMarkdown(report);
  try {
    const obs = await fs.readFile(path.join(OUT, "observations.md"), "utf8");
    md += "\n" + obs.trim() + "\n";
  } catch {}
  await fs.writeFile(path.join(OUT, "REPORT.md"), md);
}

async function main() {
  if (process.argv.includes("--report-only")) {
    // Rebuild REPORT.md from an existing report.json (+ observations.md) without re-running.
    const report = JSON.parse(await fs.readFile(path.join(OUT, "report.json"), "utf8"));
    await writeMarkdown(report);
    log("rebuilt REPORT.md from report.json");
    return;
  }
  await fs.mkdir(VIDEO_DIR, { recursive: true });
  for (const f of await fs.readdir(OUT)) if (/^\d\d-.*\.png$/.test(f)) await fs.unlink(path.join(OUT, f));

  const browser = await chromium.launch({ channel: "msedge", headless: true });
  const browserVersion = browser.version();
  log(`launched Edge ${browserVersion}, throttle ${THROTTLE}x`);
  const host = await newPage(browser, "host", true);
  const p2 = await newPage(browser, "player2", false);
  let hostResult = null;
  let p2Result = null;
  const outcome = { cheater: "a bot (neither human saw the cheater line)", endBanner: null, votes: [], offlineChip: false, revealsSeenByHost: 0 };
  let capHost = null;
  let capP2 = null;
  let videoInfo = null;
  let probe = null;

  try {
    // Home + create
    await host.page.goto(BASE, { waitUntil: "load" });
    await host.page.waitForSelector("#playerName");
    await sleep(800);
    await shot("host", host.page, "home");
    await host.page.fill("#playerName", "Host");
    await host.page.click("#hm-next");
    await act("host", "create room", () => host.page.click("[data-action=create]"));
    await host.page.waitForSelector(".roomcode", { timeout: 15000 });
    const code = (await host.page.textContent(".roomcode")).trim();
    log(`room code ${code}`);

    // Player2 joins via deep link
    await p2.page.goto(`${BASE}/#/join/${code}`, { waitUntil: "load" });
    await p2.page.waitForSelector("#playerName");
    await sleep(500);
    await shot("player2", p2.page, "home-deeplink");
    await p2.page.fill("#playerName", "Player2");
    await act("player2", "join room", () => p2.page.click("#hm-next"));
    await p2.page.waitForSelector(".roomcode", { timeout: 15000 });

    // Bots + lobby
    for (let i = 0; i < 2; i++) {
      const before = await host.page.locator(".player-li").count();
      await act("host", `add bot ${i + 1}`, () => host.page.click("[data-action=addBot]"));
      await host.page.waitForFunction((n) => document.querySelectorAll(".player-li").length > n, before, { timeout: 5000 });
    }
    await sleep(600);
    await shot("host", host.page, "lobby");
    await shot("host", host.page, "lobby-full", { fullPage: true });
    await shot("player2", p2.page, "lobby");
    await act("host", "start match", () => host.page.click("[data-action=start]"));

    // Play the match in both contexts concurrently
    [hostResult, p2Result] = await Promise.all([playLoop("host", host.page, true), playLoop("player2", p2.page, false)]);
    outcome.revealsSeenByHost = hostResult?.revealCount ?? 0;
  } catch (e) {
    log(`RUN ERROR: ${e.stack}`);
    outcome.error = String(e.message);
  } finally {
    try {
      capHost = await host.page.evaluate(() => window.__cap);
      capP2 = await p2.page.evaluate(() => window.__cap);
    } catch (e) {
      log(`collect error ${e.message}`);
    }
    const video = host.videoMode === "playwright" ? host.page.video() : null;
    if (host.videoMode === "screencast") await host.cdp.send("Page.stopScreencast").catch(() => {});
    await host.context.close();
    await p2.context.close();
    try {
      log("parity probe: dealing extra rooms until a human is the cheater");
      probe = await parityProbe(browser);
    } catch (e) {
      log(`probe error ${e.stack}`);
    }
    await browser.close();
    if (host.videoMode === "screencast") {
      try {
        videoInfo = { mode: "CDP screencast -> MJPEG AVI (Playwright ffmpeg not installed)", ...(await writeMjpegAvi(host.screencast, path.join(VIDEO_DIR, "host.avi"), 10)) };
        videoInfo.file = "capture/current/video/host.avi";
        log(`video: ${JSON.stringify(videoInfo)}`);
      } catch (e) {
        log(`avi write error ${e.stack}`);
      }
    }
    if (video) {
      videoInfo = { mode: "playwright recordVideo", file: "capture/current/video/host.webm" };
      try {
        const raw = await video.path();
        await video.saveAs(path.join(VIDEO_DIR, "host.webm"));
        if (path.resolve(raw) !== path.resolve(path.join(VIDEO_DIR, "host.webm"))) await fs.unlink(raw).catch(() => {});
      } catch (e) {
        log(`video save error ${e.message}`);
      }
    }
  }
  if (!capHost || !capP2) throw new Error("instrumentation data missing");

  const H = analyzeContext("host", capHost);
  const P = analyzeContext("player2", capP2);

  // Outcome details from the timeline/actions
  const hostCheater = H.role && !H.role.last.empty;
  const p2Cheater = P.role && !P.role.last.empty;
  if (hostCheater) outcome.cheater = "Host (human)";
  else if (p2Cheater) outcome.cheater = "Player2 (human)";
  outcome.votes = [
    ...actions.filter((a) => a.action.startsWith("vote on")).map((a) => `${a.ctx} ${a.action.replace("vote on ", "")}`),
    ...Object.entries(shared.voteResults).map(([k, v]) => `result ${k}: ${v}`),
  ];
  outcome.offlineChip = shared.offlineChip;
  outcome.endBanner = shared.endBanner;
  outcome.cheaterReveal = shared.cheaterReveal;
  if (!hostCheater && !p2Cheater && shared.cheaterReveal) outcome.cheater = `a bot — ${shared.cheaterReveal}`;

  const roleTell = {
    hostRoleExtra: H.role?.last ?? null,
    p2RoleExtra: P.role?.last ?? null,
    cheaterContext: hostCheater ? "host" : p2Cheater ? "player2" : "none (bot cheater)",
    boxesIdentical: !!(H.role && P.role && JSON.stringify(H.role.last.box) === JSON.stringify(P.role.last.box)),
    summary: "",
  };
  const cheaterRole = hostCheater ? H.role : p2Cheater ? P.role : null;
  const innocentRole = hostCheater ? P.role : p2Cheater ? H.role : H.role;
  roleTell.summary = cheaterRole
    ? `The cheater's \`.role-extra\` holds ${cheaterRole.last.trimmedLen} visible characters ("${cheaterRole.last.text}") in accent yellow while the innocent's is an empty ${innocentRole?.last.box.h}px gap. Boxes ${roleTell.boxesIdentical ? "are pixel-identical in size/position" : "DIFFER"}, so the footprint rule holds, but anyone glancing at a neighbour's phone (or a streamed screen) reads the role instantly: blank line = innocent, yellow text = cheater.${cheaterRole.textChangedDuringRole ? ` The cheater's line also pops in ${cheaterRole.msUntilFinalText} ms after the screen appears (state render first, secret render second) — a second, motion-based tell.` : ""}`
    : `In this run the cheater was a bot, so both humans saw the empty line (${H.role?.last.box.h}px tall, ${H.role?.last.trimmedLen} chars). The cheater's copy would contain "It's you. Play it cool. 😎" in the same box: identical footprint, but a blank line vs. a line of yellow text is readable from across the room.`;

  const report = {
    meta: {
      generatedAt: new Date().toISOString(),
      baseUrl: BASE,
      browser: `Microsoft Edge ${browserVersion}`,
      viewport: VIEWPORT,
      deviceScaleFactor: 2,
      cpuThrottle: THROTTLE,
      wallMs: Date.now() - t0,
      screenshotWindows: shotWindows,
      video: videoInfo,
    },
    outcome,
    actions,
    screenshots: shots,
    roleTell,
    parityProbe: probe,
    sync: syncReport(H, P),
    matchTiming: matchTiming(H),
    contexts: { host: H, player2: P },
  };

  await fs.writeFile(path.join(OUT, "report.json"), JSON.stringify(report, null, 1));
  await writeMarkdown(report);
  log(`wrote ${path.join(OUT, "report.json")} and REPORT.md (${shots.length} screenshots)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
