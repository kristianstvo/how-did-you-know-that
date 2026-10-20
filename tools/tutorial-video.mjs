// The how-to-play video (v0.20): films the tutorial's render page
// (#/tutorial/render) frame by frame and muxes it with its soundtrack (Amy's
// narration plus the game's own sound effects, mixed offline in the page) into
// an MP4: 1080×1920, 30 fps, H.264 + AAC, loudness-normalised for social apps.
// Needs ffmpeg: FFMPEG=<path>, or `npm i --no-save ffmpeg-static`, or ffmpeg on PATH.
// Usage (server running, client built):
//   npm run tutorial:video                               → media/how-to-play.mp4
//   npm run tutorial:video -- --stills 3500,16900        → capture/tutorial/still-<ms>.png
import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

const arg = (k) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : null);
const base = arg("--base") ?? "http://localhost:3000";
const stills = arg("--stills")?.split(",").map(Number);
const FPS = 30;

let ffmpeg = process.env.FFMPEG ?? "ffmpeg";
if (!process.env.FFMPEG) {
  try {
    ffmpeg = createRequire(import.meta.url)("ffmpeg-static");
  } catch {
    /* ffmpeg on PATH */
  }
}

const browser = await chromium.launch({ channel: "msedge" });
const ctx = await browser.newContext({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto(`${base}/#/tutorial/render`);
await page.waitForFunction(() => window.__tut);
await page.evaluate(() => window.__tut.ready);
const total = await page.evaluate(() => window.__tut.total);
const seek = (ms) => page.evaluate((t) => window.__tut.seek(t), ms);

if (stills) {
  mkdirSync("capture/tutorial", { recursive: true });
  for (const ms of stills) {
    await seek(ms);
    await page.screenshot({ path: `capture/tutorial/still-${ms}.png` });
  }
  console.log(JSON.stringify({ total, stills: stills.length, errors }));
  await browser.close();
  process.exit(errors.length ? 1 : 0);
}

// The soundtrack first (an offline mix in the page), then the pictures.
const tmp = join(tmpdir(), `hdykt-tutorial-${Date.now()}`);
mkdirSync(tmp, { recursive: true });
const wav = join(tmp, "soundtrack.wav");
writeFileSync(wav, Buffer.from(await page.evaluate(() => window.__tut.renderAudio()), "base64"));
mkdirSync("media", { recursive: true });
const out = "media/how-to-play.mp4";
const ff = spawn(
  ffmpeg,
  [
    "-y", "-loglevel", "error",
    "-f", "image2pipe", "-framerate", String(FPS), "-c:v", "mjpeg", "-i", "-",
    "-i", wav,
    // BT.709, tagged, so phones show the board green the page shows.
    "-vf", "scale=out_color_matrix=bt709:out_range=tv", "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709",
    "-c:v", "libx264", "-preset", "medium", "-crf", "19", "-pix_fmt", "yuv420p", "-r", String(FPS),
    "-af", "loudnorm=I=-14:TP=-1.5:LRA=11", "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-ac", "2",
    "-shortest", "-movflags", "+faststart", out,
  ],
  { stdio: ["pipe", "inherit", "inherit"] },
);
const frames = Math.ceil((total / 1000) * FPS);
const t0 = Date.now();
for (let i = 0; i < frames; i++) {
  await seek((i * 1000) / FPS);
  const jpg = await page.screenshot({ type: "jpeg", quality: 92 });
  if (!ff.stdin.write(jpg)) await once(ff.stdin, "drain");
  if (i % 300 === 0) console.log(`frame ${i}/${frames} (${Math.round((Date.now() - t0) / 1000)}s)`);
}
ff.stdin.end();
const [code] = await once(ff, "close");
rmSync(tmp, { recursive: true, force: true });
await browser.close();
console.log(JSON.stringify({ out, seconds: total / 1000, frames, ffmpeg: code, errors }));
process.exit(code || errors.length ? 1 : 0);
